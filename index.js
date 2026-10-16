import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";
import { waitForRandomTimeout, waitForTimeout, withTimeout } from "./utils.js";
import { findRowBySubject, searchOtpText } from "./puppeteer-function.js";
import { PROVIDERS, getProviderSubjects } from "./data/providers.js";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

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
const accountCreationQueue = [];
const accountCreationJobs = new Map();
const reservedAccountEmails = new Set();
let accountCreationWorkerRunning = false;
const accountCreationJobsFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "data",
  "account-creation-jobs.json",
);

function persistAccountCreationJobs() {
  fs.mkdirSync(path.dirname(accountCreationJobsFile), { recursive: true });
  fs.writeFileSync(
    accountCreationJobsFile,
    JSON.stringify(
      [...accountCreationJobs.values()].map(
        ({ id, email, status, message, launcherPath, createdAt, events }) => ({
          id,
          email,
          status,
          message,
          launcherPath,
          createdAt,
          events,
        }),
      ),
      null,
      2,
    ),
  );
}

function addAccountJobEvent(job, by, message) {
  job.events ??= [];
  job.events.push({ at: new Date().toISOString(), by, message });
  job.events = job.events.slice(-30);
  persistAccountCreationJobs();
}

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

    let failedRequests = 0;
    for (const job of accountCreationJobs.values()) {
      if (job.status !== "waiting_for_admin") continue;

      const profilePath = path.join(ACCOUNT_DATA_DIR, job.email);
      const launcherPath = path.join(ACCOUNT_LAUNCHER_DIR, `${job.email}.bat`);
      let profileExists = false;
      let launcherExists = false;
      try {
        profileExists = fs.statSync(profilePath).isDirectory();
      } catch {}
      try {
        launcherExists = fs.statSync(launcherPath).isFile();
      } catch {}

      if (profileExists && launcherExists) continue;

      job.status = "failed";
      job.message =
        "Folder profil atau file launcher hilang saat menunggu admin. Silakan buat request akun lagi.";
      addAccountJobEvent(job, "server", job.message);
      job.complete?.();
      failedRequests += 1;
    }

    console.log(
      `[ACCOUNT AUDIT] Selesai: ${accounts.length} profil diperiksa, ${restoredLaunchers} launcher dipulihkan, ${failedRequests} request aktif gagal karena file hilang.`,
    );
  } catch (error) {
    console.error("[ACCOUNT AUDIT] Gagal memeriksa file akun:", error.message);
  }
}

try {
  const savedJobs = JSON.parse(fs.readFileSync(accountCreationJobsFile, "utf8"));
  if (Array.isArray(savedJobs)) {
    for (const saved of savedJobs) {
      if (!saved?.id || !isValidAccountEmail(saved.email)) continue;
      const job = {
        ...saved,
        complete: undefined,
        events: Array.isArray(saved.events) ? saved.events : [],
      };
      if (["queued", "opening"].includes(job.status)) {
        job.status = "queued";
        job.message = "Request dipulihkan setelah server dijalankan ulang.";
        accountCreationQueue.push(job);
        reservedAccountEmails.add(job.email);
      } else if (job.status === "waiting_for_admin") {
        accountCreationQueue.push(job);
        reservedAccountEmails.add(job.email);
      }
      accountCreationJobs.set(job.id, job);
    }
  }
} catch (error) {
  if (error.code !== "ENOENT") {
    console.error("[ACCOUNT JOBS] Gagal membaca file antrean:", error.message);
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

app.post("/accounts/create", async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({
      message: "Account creation is disabled: SERVER_API_KEY is not configured.",
    });
  }

  if (req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({ message: "Unauthorized." });
  }

  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!isValidAccountEmail(email)) {
    return res
      .status(400)
      .json({ message: "Masukkan alamat email yang valid." });
  }

  try {
    fs.mkdirSync(ACCOUNT_DATA_DIR, { recursive: true });
    const existing = getAccounts().find(
      (account) => account.toLowerCase() === email,
    );
    if (existing || reservedAccountEmails.has(email)) {
      return res.status(409).json({
        message: `Profil ${existing || email} sudah ada atau sedang diantrekan.`,
      });
    }

    const id = randomUUID();
    const job = {
      id,
      email,
      status: "queued",
      message: "Menunggu giliran worker.",
      launcherPath: null,
      createdAt: new Date().toISOString(),
      events: [],
    };
    accountCreationJobs.set(id, job);
    reservedAccountEmails.add(email);
    accountCreationQueue.push(job);
    addAccountJobEvent(job, "requester", "Permintaan akun dibuat.");
    startAccountCreationWorker();

    return res.status(202).json({
      jobId: id,
      status: job.status,
      queuePosition:
        accountCreationQueue.length + (accountCreationWorkerRunning ? 1 : 0),
      message: "Permintaan masuk antrean. Admin server akan memfokuskan file saat siap.",
    });
  } catch (error) {
    console.error("[CREATE ACCOUNT]", error?.message);
    return res.status(500).json({
      message: error?.message || "Gagal membuat profil email.",
    });
  }
});

app.get("/accounts/create", (req, res) => {
  if (!API_KEY || req.headers["x-api-key"] !== API_KEY) {
    return res.status(API_KEY ? 401 : 503).json({ message: "Unauthorized." });
  }

  const jobs = [...accountCreationJobs.values()].map((job) => {
    const queueIndex = accountCreationQueue.indexOf(job);
    return {
      jobId: job.id,
      account: job.email,
      status: job.status,
      message: job.message,
      createdAt: job.createdAt,
      queuePosition:
        queueIndex >= 0
          ? queueIndex + (accountCreationWorkerRunning ? 2 : 1)
          : null,
    };
  });

  return res.json(jobs);
});

app.get("/accounts/create/:jobId", (req, res) => {
  if (!API_KEY || req.headers["x-api-key"] !== API_KEY) {
    return res.status(API_KEY ? 401 : 503).json({ message: "Unauthorized." });
  }
  const job = accountCreationJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: "Job tidak ditemukan." });
  const queueIndex = accountCreationQueue.indexOf(job);
  return res.json({
    jobId: job.id,
    account: job.email,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    queuePosition:
      queueIndex >= 0
        ? queueIndex + (accountCreationWorkerRunning ? 2 : 1)
        : null,
    launcherPath: job.launcherPath,
  });
});

app.post("/accounts/create/:jobId/complete", (req, res) => {
  if (!API_KEY || req.headers["x-api-key"] !== API_KEY) {
    return res.status(API_KEY ? 401 : 503).json({ message: "Unauthorized." });
  }

  const job = accountCreationJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: "Job tidak ditemukan." });
  if (job.status !== "waiting_for_admin") {
    return res.status(409).json({
      message: "Job belum menunggu konfirmasi admin atau sudah selesai.",
    });
  }

  addAccountJobEvent(job, "admin", "Admin mengonfirmasi proses login selesai.");
  job.complete?.();
  return res.json({ status: "completed", message: "Akun ditandai selesai." });
});

app.post("/accounts/create/:jobId/focus", async (req, res) => {
  if (!API_KEY || req.headers["x-api-key"] !== API_KEY) {
    return res.status(API_KEY ? 401 : 503).json({ message: "Unauthorized." });
  }

  const job = accountCreationJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: "Job tidak ditemukan." });
  if (job.status !== "waiting_for_admin" || !job.launcherPath) {
    return res.status(409).json({
      message: "File launcher belum siap untuk difokuskan.",
    });
  }

  try {
    await revealLauncherInExplorer(job.launcherPath);
    addAccountJobEvent(job, "admin", "Admin membuka file launcher di server.");
    return res.json({
      message: `File launcher ${job.email}.bat sudah difokuskan di komputer server.`,
    });
  } catch (error) {
    console.error("[FOCUS ACCOUNT LAUNCHER]", error?.message);
    return res.status(500).json({
      message: error?.message || "Gagal memfokuskan file launcher di server.",
    });
  }
});

app.post("/accounts/:email/focus", async (req, res) => {
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

  const launcherPath = path.resolve(ACCOUNT_LAUNCHER_DIR, `${account}.bat`);
  let launcherExists = false;
  try {
    launcherExists = fs.statSync(launcherPath).isFile();
  } catch {}
  if (!launcherExists) {
    return res.status(404).json({
      message: `File launcher ${account}.bat tidak ditemukan di server.`,
    });
  }

  try {
    await revealLauncherInExplorer(launcherPath);
    return res.json({
      message: `File ${account}.bat sudah difokuskan di komputer server.`,
    });
  } catch (error) {
    console.error("[FOCUS ACCOUNT LAUNCHER]", error?.message);
    return res.status(500).json({
      message: error?.message || "Gagal memfokuskan file launcher di server.",
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
  if (
    runningAccounts.has(accountKey) ||
    hasPendingOtp ||
    reservedAccountEmails.has(accountKey)
  ) {
    return res.status(409).json({
      message: "Email sedang dipakai atau masih dalam antrean. Coba hapus lagi setelah proses selesai.",
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

function revealLauncherInExplorer(launcherPath) {
  if (process.platform !== "win32") {
    throw new Error("Membuka file launcher dari server hanya tersedia di Windows.");
  }

  return new Promise((resolve, reject) => {
    const explorer = spawn(
      "explorer.exe",
      ["/select,", launcherPath],
      { detached: true, stdio: "ignore", windowsHide: false },
    );
    explorer.once("error", reject);
    explorer.once("spawn", async () => {
      explorer.unref();
      await bringExplorerToFront(launcherPath).catch((error) => {
        console.warn("[FOCUS EXPLORER] Gagal membawa jendela Explorer ke depan:", error.message);
      });
      resolve();
    });
  });
}

function bringExplorerToFront(launcherPath) {
  const script = String.raw`
$targetFolder = (Get-Item -LiteralPath $env:OTP_LAUNCHER_PATH).Directory.FullName
$source = @"
using System;
using System.Runtime.InteropServices;
public static class OtpWindowFocus {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
"@
Add-Type -TypeDefinition $source
$shell = New-Object -ComObject Shell.Application
$deadline = (Get-Date).AddSeconds(6)
do {
  foreach ($window in $shell.Windows()) {
    try {
      $windowPath = ([uri]$window.LocationURL).LocalPath
      if ([IO.Path]::GetFullPath($windowPath) -ieq [IO.Path]::GetFullPath($targetFolder)) {
        $handle = [IntPtr]$window.HWND
        [void][OtpWindowFocus]::ShowWindow($handle, 9)
        [void][OtpWindowFocus]::SetForegroundWindow($handle)
        exit 0
      }
    } catch {}
  }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
exit 1
`;

  return new Promise((resolve, reject) => {
    const focus = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      {
        env: { ...process.env, OTP_LAUNCHER_PATH: launcherPath },
        stdio: "ignore",
        windowsHide: true,
      },
    );
    focus.once("error", reject);
    focus.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Jendela Explorer tidak berhasil dibawa ke depan."));
    });
  });
}

// One account setup at a time. Requests wait for the server admin to focus the
// launcher, open Chrome manually, then confirm completion from the client.
function startAccountCreationWorker() {
  if (accountCreationWorkerRunning) return;
  accountCreationWorkerRunning = true;

  void (async () => {
    try {
      while (accountCreationQueue.length) {
        const job = accountCreationQueue.shift();
        try {
          if (
            job.status !== "waiting_for_admin" ||
            !job.launcherPath ||
            !fs.existsSync(job.launcherPath)
          ) {
            job.status = "opening";
            job.message = "Server menyiapkan profil dan file launcher.";
            persistAccountCreationJobs();
            const profileDir = path.join(ACCOUNT_DATA_DIR, job.email);
            if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir);
            job.launcherPath = writeAccountLauncher(job.email);
          }

          if (!fs.existsSync(CHROME_EXECUTABLE_PATH)) {
            throw new Error(`Chrome tidak ditemukan: ${CHROME_EXECUTABLE_PATH}`);
          }

          job.status = "waiting_for_admin";
          job.message =
            "Profil siap. Menunggu admin server membuka launcher dan menyelesaikan login.";
          persistAccountCreationJobs();
          if (
            !job.events.some(
              (event) => event.message === "Profil siap menunggu admin server.",
            )
          ) {
            addAccountJobEvent(job, "server", "Profil siap menunggu admin server.");
          }
          await new Promise((resolve) => {
            job.complete = resolve;
          });
          if (job.status !== "failed") {
            job.status = "completed";
            job.message = "Login selesai dikonfirmasi admin.";
            addAccountJobEvent(job, "server", "Request selesai; antrean dilanjutkan.");
          }
        } catch (error) {
          job.status = "failed";
          job.message = error?.message || "Gagal membuka profile Chrome.";
          addAccountJobEvent(job, "server", job.message);
          console.error(`[ACCOUNT WORKER] Job ${job.id} gagal:`, job.message);
        } finally {
          reservedAccountEmails.delete(job.email);
        }
      }
    } finally {
      accountCreationWorkerRunning = false;
      if (accountCreationQueue.length) startAccountCreationWorker();
    }
  })();
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
  if (accountCreationQueue.length) startAccountCreationWorker();
  const accountAuditTimer = setInterval(
    auditAccountFiles,
    ACCOUNT_ASSET_AUDIT_INTERVAL_MS,
  );
  accountAuditTimer.unref();

  app.listen(PORT, () => {
    console.log(`🚀 Server jalan di http://localhost:${PORT}`);
  });
})();
