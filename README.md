# OTP automation

Flow: client → API server → queue → Puppeteer → mail inbox → OTP response.

## Add an account from the client

In the client, click **Tambah akun email**, enter the email, then choose
**Antrekan akun**. The server creates a Chrome profile folder and a matching
`.bat` launcher when the job reaches the single account-creation worker, then
opens the profile in Chrome without navigating to a URL. Navigate manually
after Chrome opens; no form fields are filled automatically. The next request stays
queued until every Chrome window for the current profile is closed. The client
displays the queue and job status.

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

The first command creates a profile and launcher, opens Chrome without a URL, and
waits for all its Chrome windows to close. The
second exports `data/accounts.json` and creates or updates launchers for the
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
