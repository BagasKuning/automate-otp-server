# OTP automation

Flow: client → API server → queue → Puppeteer → mail inbox → OTP response.

## Request an account from the client

Anyone using the client can open **Akun baru**, enter an email, and choose
**Request akun**. Requests are processed one at a time. When a request reaches
the front of the queue, the server reuses its profile folder and `.bat` launcher
if present, creates whichever is missing, then runs the launcher automatically.
Chrome opens on the server computer. The admin completes the login manually,
closes all Chrome windows for that profile, then clicks
**Login selesai, lanjutkan antrean**. This step must be done by the server admin.

The request queue is shared by all clients connected to the same server and is
refreshed automatically in the client.
Request status and the latest 30 system events per request are saved in
`data/account-creation-jobs.json`, so the queue survives a server restart.
The file also keeps a short event history for server-side troubleshooting. Use
Discord for coordination between the requester and server admin.

Every 15 minutes, the server checks profile folders and launcher files. If a
profile folder exists but its `.bat` launcher is missing, the server recreates
the launcher. An active request is marked failed and released from the queue if
its profile folder or launcher disappears while waiting for the admin.

## Manage existing profiles

Open the client's **Admin** tab to search existing profiles and process new
account requests. The admin can delete profiles from the profile list. New
account requests launch their `.bat` file automatically when they reach the
front of the queue.

To remove a local profile, search for it in the email picker and click
**Hapus**. After confirmation, the server removes the local Chrome profile
folder and its `.bat` launcher; this does not delete the Google account itself.
Account setup requests still waiting in the queue are marked cancelled and
removed from the worker queue. A profile cannot be deleted while its Chrome
setup is active or an OTP request is running or queued. Close Chrome and finish
the active setup first.

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
