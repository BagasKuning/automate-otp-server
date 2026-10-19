import express from "express";
import cors from "cors";
import { waitForRandomTimeout, waitForTimeout, withTimeout } from "./utils.js";
import { findRowBySubject, searchOtpText } from "./puppeteer-function.js";
import { PROVIDERS, getProviderSubjects } from "./data/providers.js";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import puppeteer from "puppeteer-extra";
import stealth from "puppeteer-extra-plugin-stealth";

puppeteer.use(stealth());

import dotenv from "dotenv";
dotenv.config();
const {
  ACCOUNT_DATA_DIR,
  ACCOUNT_LAUNCHER_DIR,
  CHROME_EXECUTABLE_PATH,
  getAccounts,
  isValidAccountEmail,
  validateAccount,
} = await import("./data/accounts.js");
const { writeAccountLauncher } = await import("./account-tools.js");

// CONFIG
const PORT = 3000;
const MAX_WORKERS = 4;
const ACCOUNT_ASSET_AUDIT_INTERVAL_MS = 15 * 60 * 1000;

// STATE
const queue = [];
let activeWorkers = 0;
const runningAccounts = new Set();

function auditAccountFiles() {
  try {
    const accounts = getAccounts();
    let restoredLaunchers = 0;

    for (const account of accounts) {
      const launcherPath = path.join(ACCOUNT_LAUNCHER_DIR, `${account}.bat`);
      let launcherExists = false;
      try {
        launcherExists = fs.statSync(launcherPath).isFile();
      } catch {}

      if (!launcherExists) {
        writeAccountLauncher(account);
        restoredLaunchers += 1;
      }
    }

    console.log(
      `[ACCOUNT AUDIT] Selesai: ${accounts.length} profil diperiksa, ${restoredLaunchers} launcher dipulihkan.`,
    );
  } catch (error) {
    console.error("[ACCOUNT AUDIT] Gagal memeriksa file akun:", error.message);
  }
}

// API
const API_KEY = process.env.SERVER_API_KEY;

const app = express();
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.status(200).json({
    message: "OTP Server Ready.",
  });
});

function prepareAccountLauncher(requestedEmail) {
  fs.mkdirSync(ACCOUNT_DATA_DIR, { recursive: true });

  const account =
    getAccounts().find(
      (available) => available.toLowerCase() === requestedEmail.toLowerCase(),
    ) || requestedEmail;
  const profileDir = path.join(ACCOUNT_DATA_DIR, account);
  fs.mkdirSync(profileDir, { recursive: true });

  const launcherPath = path.join(ACCOUNT_LAUNCHER_DIR, `${account}.bat`);
  let launcherExists = false;
  try {
    launcherExists = fs.statSync(launcherPath).isFile();
  } catch {}

  return {
    account,
    launcherPath: launcherExists
      ? launcherPath
      : writeAccountLauncher(account),
  };
}

app.post("/accounts/create", async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({
      message:
        "Account creation is disabled: SERVER_API_KEY is not configured.",
    });
  }

  if (req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({ message: "Unauthorized." });
  }

  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
  if (!isValidAccountEmail(email)) {
    return res
      .status(400)
      .json({ message: "Masukkan alamat email yang valid." });
  }

  try {
    if (!fs.existsSync(CHROME_EXECUTABLE_PATH)) {
      throw new Error(`Chrome tidak ditemukan: ${CHROME_EXECUTABLE_PATH}`);
    }
    const { account, launcherPath } = prepareAccountLauncher(email);
    await launchAccountBatchFile(launcherPath);
    return res.json({
      account,
      status: "opened",
      message: `Chrome untuk ${account} sudah dibuka di komputer server. Silakan lanjutkan login secara manual.`,
    });
  } catch (error) {
    console.error("[CREATE ACCOUNT]", error?.message);
    return res.status(500).json({
      message: error?.message || "Gagal membuat profil email.",
    });
  }
});

app.delete("/accounts/:email", (req, res) => {
  if (!API_KEY || req.headers["x-api-key"] !== API_KEY) {
    return res.status(API_KEY ? 401 : 503).json({ message: "Unauthorized." });
  }

  const requestedEmail = req.params.email.trim().toLowerCase();
  if (!isValidAccountEmail(requestedEmail)) {
    return res.status(400).json({ message: "Alamat email tidak valid." });
  }

  const account = getAccounts().find(
    (available) => available.toLowerCase() === requestedEmail,
  );
  if (!account) {
    return res.status(404).json({ message: "Profil email tidak ditemukan." });
  }

  const accountKey = account.toLowerCase();
  const hasPendingOtp = queue.some(
    (job) => job.account.trim().toLowerCase() === accountKey,
  );
  if (runningAccounts.has(accountKey) || hasPendingOtp) {
    return res.status(409).json({
      message:
        "Email sedang dipakai atau masih dalam antrean OTP. Coba hapus lagi setelah proses selesai.",
    });
  }

  try {
    const profileDir = path.resolve(ACCOUNT_DATA_DIR, account);
    const launcherPath = path.resolve(ACCOUNT_LAUNCHER_DIR, `${account}.bat`);
    if (path.dirname(profileDir) !== path.resolve(ACCOUNT_DATA_DIR)) {
      return res.status(400).json({ message: "Lokasi profil tidak valid." });
    }
    if (path.dirname(launcherPath) !== path.resolve(ACCOUNT_LAUNCHER_DIR)) {
      return res.status(400).json({ message: "Lokasi launcher tidak valid." });
    }

    fs.rmSync(profileDir, { recursive: true });
    fs.rmSync(launcherPath, { force: true });
    return res.json({
      account,
      message: `Profil ${account} dan launcher-nya berhasil dihapus.`,
    });
  } catch (error) {
    console.error("[DELETE ACCOUNT]", error?.message);
    return res.status(500).json({
      message: error?.message || "Gagal menghapus profil email.",
    });
  }
});

app.use((req, res, next) => {
  console.log("[REQ] ", req.url);
  const userKey = req.headers["x-api-key"];

  return next(); // client masi gagal kirim "x-api-key"
  if (userKey && userKey === API_KEY) {
  }

  return res.status(401).json({ message: "Unauthorized: Invalid API Key" });
});

app.post("/get-otp", (req, res) => {
  try {
    const requestId = Date.now();

    const { account, provider, password } = req.body;

    if (!account || !provider)
      throw new Error('Missing "account" or "provider" in req body.');
    else if (!account.includes("gmail.com") && !password) {
      throw new Error('"password" must be filled.');
    } else if (!PROVIDERS.includes(provider))
      throw new Error("this provider is not availabale.");
    else if (!validateAccount(account)) {
      throw new Error("ACCOUNT_NOT_ALLOWED");
    }

    queue.push({ requestId, res, account, provider, password });

    console.log("📥 QUEUE IN:", account);
  } catch (error) {
    console.error("[GET OTP] ", error?.message);
    res.status(400).json({ message: error?.message || "something wrong." });
  }
});

app.get("/accounts", (req, res) => {
  try {
    res.json(getAccounts());
  } catch (error) {
    res.status(500).json({
      message: error?.message || "failed to fetch accounts",
    });
  }
});

async function getOTP(page, provider) {
  try {
    const providerSubjects = getProviderSubjects(provider);

    if (!providerSubjects.length) {
      throw new Error("Provider subject not found.");
    }

    await waitForRandomTimeout(3590, 6043);
    const row = await findRowBySubject(page, providerSubjects, provider);

    if (!row) throw new Error("Inbox not found");

    await row.evaluate((el, provider) => {
      const target =
        provider === "freepik" ? el.querySelector("a") : el.closest("tr") || el;

      target?.click();
    }, provider);

    await waitForRandomTimeout(4674, 8342);
    const otp = await searchOtpText(page, provider);

    return otp;
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error("GMAIL_TIMEOUT");
    }
    throw err;
  }
}

function launchAccountBatchFile(launcherPath) {
  if (process.platform !== "win32") {
    throw new Error(
      "Menjalankan file launcher dari server hanya tersedia di Windows.",
    );
  }

  if (!fs.statSync(launcherPath).isFile()) {
    throw new Error("File launcher tidak ditemukan di server.");
  }

  return new Promise((resolve, reject) => {
    const launcherProcess = spawn(
      "cmd.exe",
      ["/d", "/c", "call", launcherPath],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    launcherProcess.once("error", reject);
    launcherProcess.once("spawn", () => {
      launcherProcess.unref();
      resolve();
    });
  });
}

// QUEUE PROCESSOR
async function processJob(job, accountKey) {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: false,
      executablePath: CHROME_EXECUTABLE_PATH,
      userDataDir: path.join(ACCOUNT_DATA_DIR, job.account),
      args: ["--no-sandbox"],
    });

    const task = runJob(job, browser);
    await withTimeout(() => task, 420000);
  } catch (err) {
    console.error("[JOB KILLED]", err.message);
    console.log(err);

    if (browser) {
      try {
        await browser.close();
      } catch {}

      try {
        const pid = browser.process()?.pid;
        if (pid) process.kill(pid, "SIGKILL");
      } catch {}
    }

    try {
      if (!job.res.headersSent) {
        job.res.status(500).json({ error: err.message });
      }
    } catch {}
  } finally {
    runningAccounts.delete(accountKey);
    activeWorkers--;
  }
}

async function processQueue() {
  while (true) {
    while (activeWorkers < MAX_WORKERS) {
      const queueIndex = queue.findIndex(
        (job) => !runningAccounts.has(job.account.trim().toLowerCase()),
      );
      if (queueIndex === -1) break;

      const [job] = queue.splice(queueIndex, 1);
      const accountKey = job.account.trim().toLowerCase();
      runningAccounts.add(accountKey);
      activeWorkers++;
      void processJob(job, accountKey);
    }

    await waitForTimeout(200);
  }
}
// RUN JOB
async function runJob(job, browser) {
  const pages = await browser.pages();
  const page = pages[0];

  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);

  if (job.account.includes("xyz")) {
    await page.goto("https://srv101.niagahoster.com:2096", {
      waitUntil: "networkidle2",
    });

    await page.waitForSelector("#user");
    await page.waitForSelector("#pass");

    const userInput = await page.$("#user");
    const passwordInput = await page.$("#pass");
    const submitButton = await page.$("#login_submit");

    await userInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");

    await passwordInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");

    await userInput.type(job.account, { delay: 20 });
    await passwordInput.type(job.password, { delay: 20 });

    await submitButton.click();

    await page.waitForNavigation({
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    const currentUrl = page.url();

    if (!currentUrl.includes("/cpsess") && !currentUrl.includes("roundcube")) {
      throw new Error("LOGIN_FAILED_XYZ");
    }
  } else {
    await page.goto("https://mail.google.com", {
      waitUntil: "networkidle2",
    });
  }

  const otp = await getOTP(page, job.provider);
  await browser.close();

  job.res.json({
    otp,
    provider: job.provider,
    account: job.account,
  });
}

// START
(async () => {
  processQueue();
  const accountAuditTimer = setInterval(
    auditAccountFiles,
    ACCOUNT_ASSET_AUDIT_INTERVAL_MS,
  );
  accountAuditTimer.unref();

  app.listen(PORT, () => {
    console.log(`🚀 Server jalan di http://localhost:${PORT}`);
  });
})();
