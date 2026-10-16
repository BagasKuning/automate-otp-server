import fs from "node:fs";
import path from "node:path";

export const ACCOUNT_DATA_DIR = path.resolve(
  process.env.ACCOUNT_DATA_DIR || String.raw`D:\account-administrator\data`,
);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getAccounts() {
  return fs
    .readdirSync(ACCOUNT_DATA_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && EMAIL_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function validateAccount(account) {
  if (typeof account !== "string" || !EMAIL_PATTERN.test(account.trim())) {
    return false;
  }

  const normalizedAccount = account.trim().toLowerCase();
  return getAccounts().some((available) => available.toLowerCase() === normalizedAccount);
}
