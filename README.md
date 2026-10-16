# OTP automation

Flow: Client → API server → queue → Puppeteer → mail inbox → OTP response.

## Chrome profiles

Profiles are read from `D:\account-administrator\data`. Each profile folder
whose name is an email address appears in the API's `/accounts` response and in
the client account picker. The list is read from disk on every request, so new
or removed profile folders are reflected without regenerating a whitelist or
restarting the server.

The server opens the selected profile folder directly:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="D:\account-administrator\data\name@mail.com" --no-first-run --no-default-browser-check
```

Set these optional values in the server `.env` if the paths differ:

```env
ACCOUNT_DATA_DIR=D:\account-administrator\data
CHROME_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

The client loads `/api/accounts`, which is proxied to the server's `/accounts`
endpoint. It refreshes the list periodically and when the browser tab regains
focus. To export the current list to `data/accounts.json` for inspection:

```powershell
npm run accounts:generate
```

The JSON export is informational; the API and client continue to use the live
profile directory as their source of truth.
