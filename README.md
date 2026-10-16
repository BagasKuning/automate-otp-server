# OTP automation

Flow: client → API server → queue → Puppeteer → mail inbox → OTP response.

## Request an account from the client

Anyone using the client can open **Akun baru**, enter an email, and choose
**Request akun**. Requests are processed one at a time. When a request is ready,
the admin at the server computer clicks **Fokuskan file .bat di server**; this
opens File Explorer on the server with the launcher selected. Run the `.bat`
file, finish the login in Chrome, close all Chrome windows for that profile,
then click **Login selesai, lanjutkan antrean**. The next queued request can
then be prepared. Explorer appears on the computer running the server, so this
step must be done by the server admin.

The request queue is shared by all clients connected to the same server and is
refreshed automatically in the client.
Request status and the latest 30 system events per request are saved in
`data/account-creation-jobs.json`, so the queue survives a server restart.
The file also keeps a short event history for server-side troubleshooting. Use
Discord for coordination between the requester and server admin.

## Find an existing launcher

Open the client's **Admin** tab, search for an existing email, then choose
**Fokus file .bat**. The server selects the matching launcher directly in File
Explorer, so there is no need to use Windows Search. The same tab lists new
account requests for the admin to process. Explorer opens on the server
computer.

To remove a local profile, search for it in the email picker and click
**Hapus**. After confirmation, the server removes the local Chrome profile
folder and its `.bat` launcher; this does not delete the Google account itself.
Profiles currently used by a server job or queued for an OTP request cannot be
deleted. Close any Chrome windows opened manually for that profile first.

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

The first command creates a profile and launcher and opens File Explorer with
the launcher selected. Run it manually to open Chrome. The second exports
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
