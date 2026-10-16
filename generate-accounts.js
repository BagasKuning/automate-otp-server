import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { ACCOUNT_DATA_DIR, getAccounts } from "./data/accounts.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(scriptDir, "data", "accounts.json");
const accounts = getAccounts();

fs.writeFileSync(outputPath, `${JSON.stringify(accounts, null, 2)}\n`);
console.log(`${accounts.length} accounts exported to ${outputPath}`);
console.log(`Source profiles: ${ACCOUNT_DATA_DIR}`);
