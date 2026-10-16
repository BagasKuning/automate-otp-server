import fs from "node:fs";
import path from "node:path";
import {
  ACCOUNT_DATA_DIR,
  ACCOUNT_LAUNCHER_DIR,
  CHROME_EXECUTABLE_PATH,
} from "./data/accounts.js";

export function writeAccountLauncher(account) {
  const profileDir = path.join(ACCOUNT_DATA_DIR, account);
  const launcherPath = path.join(ACCOUNT_LAUNCHER_DIR, `${account}.bat`);

  fs.mkdirSync(ACCOUNT_LAUNCHER_DIR, { recursive: true });
  fs.writeFileSync(
    launcherPath,
    [
      "@echo off",
      "setlocal",
      `set "CHROME=${CHROME_EXECUTABLE_PATH}"`,
      `set "DATA=${profileDir}"`,
      'if not exist "%DATA%" mkdir "%DATA%"',
      'start "" "%CHROME%" --user-data-dir="%DATA%" --no-first-run --no-default-browser-check',
      "endlocal",
      "",
    ].join("\r\n"),
    "utf8",
  );

  return launcherPath;
}
