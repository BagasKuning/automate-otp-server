import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";
import { waitForRandomTimeout, waitForTimeout, withTimeout } from "./utils.js";
import { findRowBySubject, searchOtpText } from "./puppeteer-function.js";
import { PROVIDERS, getProviderSubjects } from "./data/providers.js";
import path from "node:path";

import dotenv from "dotenv";
dotenv.config();
const { ACCOUNT_DATA_DIR, getAccounts, validateAccount } = await import(
  "./data/accounts.js"
);

// CONFIG
const PORT = 3000;
const MAX_WORKERS = 4;

// STATE
const queue = [];
let activeWorkers = 0;

// API
const API_KEY = process.env.SERVER_API_KEY;

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).json({
    message: "OTP Server Ready.",
  });
});

app.use(cors());
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

// QUEUE PROCESSOR
async function processQueue() {
  const browserMap = new Map();

  while (true) {
    if (queue.length === 0) {
      await waitForTimeout(200);
      continue;
    }

    const job = queue.shift();

    while (activeWorkers >= MAX_WORKERS) {
      await waitForTimeout(200);
    }

    activeWorkers++;

    let browser;

    try {
      browser = await puppeteer.launch({
        headless: false,
        executablePath:
          process.env.CHROME_EXECUTABLE_PATH ||
          String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
        userDataDir: path.join(ACCOUNT_DATA_DIR, job.account),
        args: ["--no-sandbox"],
      });

      browserMap.set(job.requestId, browser);

      const task = runJob(job, browser);

      await withTimeout(() => task, 420000);

      browserMap.delete(job.requestId);
    } catch (err) {
      console.error("💥 JOB KILLED:", err.message);
      console.log(err);

      const browser = browserMap.get(job.requestId);

      if (browser) {
        try {
          await browser.close();
        } catch {}

        try {
          const pid = browser.process()?.pid;
          if (pid) process.kill(pid, "SIGKILL");
        } catch {}

        browserMap.delete(job.requestId);
      }

      try {
        job.res.status(500).json({
          error: err.message,
        });
      } catch {}
    } finally {
      activeWorkers--;
    }
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

  app.listen(PORT, () => {
    console.log(`🚀 Server jalan di http://localhost:${PORT}`);
  });
})();
