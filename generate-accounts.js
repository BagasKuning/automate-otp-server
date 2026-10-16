import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import {
  ACCOUNT_DATA_DIR,
  ACCOUNT_LAUNCHER_DIR,
  getAccounts,
} from "./data/accounts.js";
import { writeAccountLauncher } from "./account-tools.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(scriptDir, "data", "accounts.json");
const accounts = getAccounts();

fs.writeFileSync(outputPath, `${JSON.stringify(accounts, null, 2)}\n`);
for (const account of accounts) writeAccountLauncher(account);

console.log(`${accounts.length} accounts exported to ${outputPath}`);
console.log(`${accounts.length} Chrome launchers synced to ${ACCOUNT_LAUNCHER_DIR}`);
console.log(`Source profiles: ${ACCOUNT_DATA_DIR}`);
