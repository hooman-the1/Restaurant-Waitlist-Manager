# Frontend

Angular single-page application for restaurant staff and waitlist customers.
It includes restaurant signup and verification, a staff dashboard, public
waitlist joining, and private customer status and cancellation pages.

## Run locally

Requirements: Node.js 20.19+ and npm. Start the backend on port `8000` first.

```powershell
cd front
npm install
npm start
```

Open `http://localhost:4200`. The application sends API requests, including
staff session cookies, to `http://localhost:8000`.

## Application routes

| Route | Purpose |
| --- | --- |
| `/signup` | Create a restaurant account |
| `/verify/:token` | Verify a restaurant and start its staff session |
| `/dashboard` | Manage the restaurant's active waitlist |
| `/restaurants/:slug` | Public page for joining a restaurant waitlist |
| `/status/:token` | View or cancel a customer's waitlist entry |

## Useful commands

```powershell
npm start
npm test
npm run build
```

The local API base URL is defined in `src/app/api-base-url.ts`. See the
[repository README](../README.md) for full setup instructions and demo URLs.
