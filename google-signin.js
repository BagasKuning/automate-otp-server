import puppeteer from "puppeteer-extra";
import stealth from "puppeteer-extra-plugin-stealth";

puppeteer.use(stealth());

import { CHROME_EXECUTABLE_PATH } from "./data/accounts.js";

/** Open a new Chrome profile without navigating it, then hold the account
 * creation worker until the Chrome window is closed. */
export async function openGoogleSignIn(profileDir, onState = () => {}) {
  console.log(
    "[ACCOUNT WORKER] Menjalankan Chrome tanpa membuka URL tertentu.",
  );
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_EXECUTABLE_PATH,
    userDataDir: profileDir,
    args: ["--no-sandbox", "--no-first-run", "--no-default-browser-check"],
  });

  onState("opening");
  const pages = await browser.pages();
  if (pages.length === 0) await browser.newPage();

  onState("waiting_for_browser_close");
  console.log(
    "[ACCOUNT WORKER] Chrome terbuka. Menunggu semua jendela profile ini ditutup.",
  );
  await waitUntilBrowserClosed(browser);
  console.log(
    "[ACCOUNT WORKER] Chrome ditutup; worker siap memproses antrean berikutnya.",
  );
}

function waitUntilBrowserClosed(browser) {
  return new Promise((resolve) => {
    let settled = false;
    let emptyPageChecks = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      browser.off("disconnected", finish);
      resolve();
    };

    browser.once("disconnected", finish);
    const interval = setInterval(async () => {
      try {
        const pages = await browser.pages();
        emptyPageChecks = pages.length === 0 ? emptyPageChecks + 1 : 0;
        // Chrome may keep a background process after its last window closes.
        if (emptyPageChecks >= 3) finish();
      } catch {
        finish();
      }
    }, 1000);

    // Cover the case where Chrome exits between launch and listener setup.
    browser.process()?.once("exit", finish);
  });
}
