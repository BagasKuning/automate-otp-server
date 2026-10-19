# OTP automation

Flow: client → API server → queue → Puppeteer → mail inbox → OTP response.

## Request an account from the client

In the client, open **Akun baru**, enter an email, then press Enter or click
**Buka Chrome**. The server reuses the profile folder and `.bat`
launcher if present, creates either one if missing, then runs the launcher
immediately. Chrome opens on the server computer and the admin completes the
login manually. This flow has no account request queue or worker.

Every 15 minutes, the server checks profile folders and launcher files. If a
profile folder exists but its `.bat` launcher is missing, the server recreates
the launcher.

## Manage existing profiles

Open the client's **Admin** tab to search existing profiles. The admin can
delete profiles from the profile list. New account requests are submitted from
the **Akun baru** tab and open Chrome immediately.

To remove a local profile, search for it in the email picker and click
**Hapus**. After confirmation, the server removes the local Chrome profile
folder and its `.bat` launcher; this does not delete the Google account itself.
An account profile cannot be deleted while an OTP request is running or queued.
Close any Chrome windows opened manually for that profile first.

The server must run in the signed-in Windows desktop session for the Chrome
window to be visible to the admin. The create-profile endpoint requires the
`x-api-key` header to match `SERVER_API_KEY` in the server `.env`. The local
Vite proxy reads this key from the server `.env`. For Netlify, set the same
`SERVER_API_KEY` as a function environment variable.

For maintenance, the CLI is available from this project directory:

```powershell
npm run account:add -- name@mail.com
npm run accounts:generate
```

The first command creates a profile and launcher, then runs the launcher to
open Chrome. Complete the login manually. The second exports
`data/accounts.json` and creates or updates launchers for the
existing profiles. It does not delete old launchers or profiles.

## Chrome profile paths

Each email-named folder under `D:\account-administrator\data` is one Chrome
profile. The API reads the folders on every `/accounts` request, and the client
syncs them without regenerating a whitelist or restarting the server.

Set these optional values in the server `.env` if the paths differ:

```env
ACCOUNT_DATA_DIR=D:\account-administrator\data
ACCOUNT_LAUNCHER_DIR=D:\account-administrator
CHROME_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

OTP requests for different accounts can run in parallel (up to four workers).
Requests for the same email wait until that account's Chrome profile is free.
