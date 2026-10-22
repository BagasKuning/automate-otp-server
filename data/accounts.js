import fs from "node:fs";
import path from "node:path";

function chooseAccountDataDir() {
  if (process.env.ACCOUNT_DATA_DIR) return path.resolve(process.env.ACCOUNT_DATA_DIR);
  if (process.platform !== "win32") return path.resolve(String.raw`D:\account-administrator\data`);

  const candidates = [String.raw`D:\account-administrator\data`, String.raw`C:\account-administrator\data`];
  // Keep using whichever location already contains profiles; otherwise prefer D
  // when it has at least 5 GB free, then fall back to C.
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.readdirSync(candidate).some((entry) => EMAIL_PATTERN.test(entry))) return path.resolve(candidate);
    } catch {}
  }
  for (const candidate of candidates) {
    try {
      if (fs.statfsSync(path.parse(candidate).root).bavail * fs.statfsSync(path.parse(candidate).root).bsize >= 5 * 1024 ** 3) return path.resolve(candidate);
    } catch {}
  }
  return path.resolve(candidates[1]);
}

const EMAIL_PATTERN = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
export const ACCOUNT_DATA_DIR = chooseAccountDataDir();

export const ACCOUNT_LAUNCHER_DIR = path.resolve(
  process.env.ACCOUNT_LAUNCHER_DIR || path.dirname(ACCOUNT_DATA_DIR),
);

export const CHROME_EXECUTABLE_PATH =
  process.env.CHROME_EXECUTABLE_PATH ||
  String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;

export function isValidAccountEmail(account) {
  return typeof account === "string" && EMAIL_PATTERN.test(account.trim());
}

export function getAccounts() {
  return fs
    .readdirSync(ACCOUNT_DATA_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isValidAccountEmail(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function validateAccount(account) {
  if (!isValidAccountEmail(account)) return false;

  const normalizedAccount = account.trim().toLowerCase();
  return getAccounts().some(
    (available) => available.toLowerCase() === normalizedAccount,
  );
}
