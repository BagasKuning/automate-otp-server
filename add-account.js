import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import "dotenv/config";
import {
  ACCOUNT_DATA_DIR,
  CHROME_EXECUTABLE_PATH,
  getAccounts,
  isValidAccountEmail,
} from "./data/accounts.js";
import { writeAccountLauncher } from "./account-tools.js";

async function main() {
  let email = process.argv[2]?.trim();

  if (!email) {
    const prompt = createInterface({ input: stdin, output: stdout });
    email = (await prompt.question("Email akun baru: ")).trim();
    prompt.close();
  }

  if (!isValidAccountEmail(email)) {
    throw new Error("Format email tidak valid.");
  }
  email = email.toLowerCase();

  fs.mkdirSync(ACCOUNT_DATA_DIR, { recursive: true });

  const existing = getAccounts().find(
    (account) => account.toLowerCase() === email.toLowerCase(),
  );
  if (existing) {
    throw new Error(`Profil ${existing} sudah ada di daftar.`);
  }

  const profileDir = path.join(ACCOUNT_DATA_DIR, email);
  fs.mkdirSync(profileDir, { recursive: true });
  const launcherPath = writeAccountLauncher(email);

  console.log(`Folder profil dibuat: ${profileDir}`);
  console.log(`Launcher dibuat: ${launcherPath}`);

  if (!fs.existsSync(CHROME_EXECUTABLE_PATH)) {
    console.log(
      `Chrome tidak ditemukan di ${CHROME_EXECUTABLE_PATH}. Jalankan launcher secara manual atau atur CHROME_EXECUTABLE_PATH.`,
    );
    return;
  }

  await new Promise((resolve, reject) => {
    execFile(
      "explorer.exe",
      [`/select,${launcherPath}`],
      { windowsHide: false },
      (error) => (error ? reject(error) : resolve()),
    );
  });
  console.log("File launcher dipilih di File Explorer. Jalankan secara manual.");
  console.log("Akun akan tersedia di client setelah daftar di-sync.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
