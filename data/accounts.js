import fs from "node:fs";
import path from "node:path";

export const ACCOUNT_DATA_DIR = path.resolve(
  process.env.ACCOUNT_DATA_DIR || String.raw`D:\account-administrator\data`,
);

const EMAIL_PATTERN = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

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
