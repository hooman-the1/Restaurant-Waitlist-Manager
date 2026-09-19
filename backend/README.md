# Restaurant Waitlist Manager backend

This directory contains the NestJS API and its TypeORM-backed persistence layer.

## Run locally

Prerequisites: Node.js 20.19 or newer (use 22.13 or newer on the Node 22 line) and npm.

From `backend/`:

```powershell
npm ci
Copy-Item .env.example .env
```

Edit `.env`, replace the placeholder `SECRET_KEY` with a strong local value,
and confirm the database location before starting the API:

```powershell
npm start
```

The default API base URL is `http://localhost:8000`. Local configuration is:

- `PORT=8000`: HTTP listen port.
- `FRONTEND_ORIGIN=http://localhost:4200`: browser origin allowed to make credentialed CORS requests.
- `SECRET_KEY`: sensitive signing material for `restaurant_session` cookies. Never publish or commit it; the placeholder is rejected.
- `DATABASE_URL=sqlite://./data/waitlist.sqlite`: required database connection URL. The documented value creates `backend/data/waitlist.sqlite` when the backend starts.

The SQLite file and schema are created automatically. Restaurant accounts,
verification state, active entries, and today's resolved entries persist across
backend restarts. Schema migrations are intentionally out of scope for this
local MVP; after a schema change, stop the backend and delete the local SQLite
file to let TypeORM recreate it. To reset all local data at any time, stop the
backend and delete `data/waitlist.sqlite` plus any adjacent
`waitlist.sqlite-shm` or `waitlist.sqlite-wal` files. The `data/*.sqlite*`
files are ignored by Git.

API documentation is available at:

- `http://localhost:8000/docs`
- `http://localhost:8000/redoc`
- `http://localhost:8000/openapi.json`

## Deterministic demo data

The seeded public restaurant slug is `demo-restaurant`. Its API and customer status URLs are:

- Public API: `http://localhost:8000/api/restaurants/demo-restaurant`
- Morgan Lee, active: `http://localhost:8000/api/waitlist-entries/8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44`
- Sam Rivera, active: `http://localhost:8000/api/waitlist-entries/7a2bfe87-27d4-4e13-8b0d-e7804c1e7421`
- Alex Chen, resolved as seated: `http://localhost:8000/api/waitlist-entries/c2a7198e-6d40-4b53-9f81-37e5a6c04bd2`

The active staff action references returned by the seeded dashboard are:

- Morgan: `9c777a3d-b7ed-4c86-95ce-7f456a62ff11`
- Sam: `c5f2a8d4-6b31-47e0-9a25-2d8e6c714903`

The corresponding Angular-shaped demo paths are:

- `http://localhost:4200/restaurants/demo-restaurant`
- `http://localhost:4200/status/8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44`
- `http://localhost:4200/status/7a2bfe87-27d4-4e13-8b0d-e7804c1e7421`
- `http://localhost:4200/status/c2a7198e-6d40-4b53-9f81-37e5a6c04bd2`

The production `front/` application calls this API at `http://localhost:8000`.
Reloading an Angular page or restarting the backend preserves database state
and the browser's signed session cookie.

## Local restaurant sessions

There are two supported local paths:

1. Sign up a new restaurant through `POST /api/restaurants`, follow the one-time local verification URL, and retain the returned cookie in the browser or HTTP cookie jar.
2. Sign the seeded payload `demo-restaurant` using the same `SECRET_KEY` as the running backend. The following PowerShell example reads the secret without displaying it and places the complete Cookie header value on the clipboard without printing or writing it to the repository:

```powershell
$localSecret = Read-Host 'SECRET_KEY' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($localSecret)
try {
  $env:DEMO_SIGNING_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  node -e "const {sign}=require('cookie-signature'); process.stdout.write('restaurant_session='+encodeURIComponent('s:'+sign('demo-restaurant',process.env.DEMO_SIGNING_SECRET)))" | Set-Clipboard
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  Remove-Item Env:DEMO_SIGNING_SECRET
}
```

The seeded restaurant has no usable login password or verification token. `demo-restaurant` alone is only the signed payload, not a valid cookie. Protected requests send the signed value in the `restaurant_session` cookie, not in a bearer or JWT `Authorization` header.

Authentication has no server-side session record: the browser holds the signed
cookie. A retained cookie remains valid after restart when the browser keeps it,
the restaurant remains in the database, and the backend uses the same
`SECRET_KEY`; changing the secret invalidates existing signatures.

## Persistence lifecycle

Runtime signups, joins, resolutions, and unused verification tokens are stored
in SQLite. Consumed tokens and entries removed by cleanup remain deleted after
restart. Demo data is seeded only when the documented demo restaurant does not
already exist, so startup does not overwrite persisted changes. `store.reset()`
remains an internal test seam, not an HTTP or admin endpoint.

## Verification

Run these commands from `backend/`:

```text
npm test
npm run lint
npm run format:check
npm run openapi:check
npm run build
```
