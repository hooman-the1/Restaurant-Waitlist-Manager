# Restaurant Waitlist Manager backend

This directory contains the NestJS API and its application-scoped in-memory store.

## Run locally

Prerequisites: Node.js 20.19 or newer (use 22.13 or newer on the Node 22 line) and npm.

From `backend/`:

```powershell
npm ci
Copy-Item .env.example .env
```

Edit `.env` and replace the placeholder `SECRET_KEY` with a strong local value, then start the API:

```powershell
npm start
```

The default API base URL is `http://localhost:8000`. Local configuration is:

- `PORT=8000`: HTTP listen port.
- `FRONTEND_ORIGIN=http://localhost:4200`: browser origin allowed to make credentialed CORS requests.
- `SECRET_KEY`: sensitive signing material for `restaurant_session` cookies. Never publish or commit it; the placeholder is rejected.

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

The current `front/` application is mock-backed. These Angular paths are convenient shapes only; they are not evidence that the frontend sends HTTP requests to this API.

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

Authentication has no server-side session record: the browser holds the signed cookie. After a restart, an old cookie for a runtime-created restaurant is unauthorized because that account no longer exists. A retained seeded-demo cookie can remain valid only when the browser keeps it and the restarted backend uses the same `SECRET_KEY`; changing the secret invalidates existing signatures.

## In-memory lifecycle

Runtime signups, joins, resolutions, and consumed verification tokens are lost when the backend stops. A new process recreates only the deterministic seed. `store.reset()` is an internal test seam, not an HTTP or admin endpoint.

## Verification

Run these commands from `backend/`:

```text
npm test
npm run lint
npm run format:check
npm run openapi:check
npm run build
```
