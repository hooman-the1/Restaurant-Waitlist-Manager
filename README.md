# Restaurant Waitlist Manager

A lightweight, multi-restaurant waitlist application for local development.
Restaurant staff can create and verify an account, share a public waitlist
link, and manage guests from a dashboard. Customers can join without an
account, follow their queue position through a private link, and cancel their
entry.

## Features

### Restaurant staff

- Create a restaurant account with a unique name, email, and public slug.
- Complete account verification through a one-time local verification link.
- Use a signed, HttpOnly cookie to access the staff dashboard.
- View the active queue in first-in, first-out order.
- Mark an entry as seated, cancelled, or no-show.
- Review entries resolved during the current server-local day.

### Customers

- Join a restaurant's waitlist from its public URL without creating an account.
- Submit a name, phone number, and party size.
- Receive a private status URL with the current queue position.
- Cancel an active entry from the private status page.
- See the final status after an entry is resolved.

## Technology

| Area | Stack |
| --- | --- |
| Frontend | Angular 16, TypeScript, RxJS, standalone components |
| Backend | NestJS 11, TypeScript, Express |
| Persistence | TypeORM with SQLite (`better-sqlite3`) |
| Authentication | Signed HttpOnly browser cookie |
| API documentation | OpenAPI 3.1, Swagger UI, Scalar |
| Testing | Jasmine/Karma on the frontend; Jest/Supertest on the backend |

## Repository layout

```text
.
|-- backend/          NestJS API, persistence, seed data, and backend tests
|-- front/            Angular application and frontend tests
|-- doc/              Product plan, frontend tasks, and team process notes
|-- _docs/            Backend implementation backlog
|-- team/             Project role instructions
|-- openapi.yaml      Authoritative HTTP API contract
`-- README.md         Project documentation
```

## Prerequisites

- Node.js 20.19 or newer. On the Node.js 22 line, use 22.13 or newer.
- npm.
- A browser for the Angular application.

No separate database server is required; the backend uses a local SQLite file.

## Quick start

### 1. Configure and start the backend

From the repository root:

```powershell
cd backend
npm ci
Copy-Item .env.example .env
```

Open `backend/.env` and replace
`replace-with-a-local-signing-secret` with a strong local secret. Keep secrets
and session cookies out of source control. Then start the API:

```powershell
npm start
```

The backend starts at `http://localhost:8000` and creates the SQLite database
and demo data automatically.

### 2. Start the frontend

In a second terminal, from the repository root:

```powershell
cd front
npm install
npm start
```

Open `http://localhost:4200`. Keep both development servers running while using
the application.

## Try the application

### Create a staff session

1. Open `http://localhost:4200/signup`.
2. Submit a restaurant name, email, and password.
3. Find the one-time verification URL in the backend terminal output.
4. Open that URL in the same browser.
5. After verification, use `http://localhost:4200/dashboard`.

Verification sets a signed `restaurant_session` cookie. The frontend includes
that cookie in credentialed API requests; there is no bearer-token login flow.

### Use the seeded demo data

The backend creates `demo-restaurant` the first time it initializes a database.
These frontend pages are available immediately:

- Public waitlist: `http://localhost:4200/restaurants/demo-restaurant`
- Morgan Lee, active: `http://localhost:4200/status/8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44`
- Sam Rivera, active: `http://localhost:4200/status/7a2bfe87-27d4-4e13-8b0d-e7804c1e7421`
- Alex Chen, seated: `http://localhost:4200/status/c2a7198e-6d40-4b53-9f81-37e5a6c04bd2`

The seeded restaurant has no usable password or verification token. To exercise
the normal staff dashboard flow, create and verify a new restaurant account.

## Application routes

| Frontend route | Access | Description |
| --- | --- | --- |
| `/signup` | Public | Restaurant account creation |
| `/verify/:token` | Public, token required | One-time restaurant verification |
| `/dashboard` | Verified restaurant session | Active queue and resolved-today management |
| `/restaurants/:slug` | Public | Restaurant lookup and waitlist join form |
| `/status/:token` | Public, private token required | Customer position, final status, and cancellation |

Unknown frontend routes display the not-found page.

## API

The backend exposes an unversioned REST API under `/api`.

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/restaurants` | Create an unverified restaurant account |
| `POST` | `/api/restaurant-verifications` | Verify an account and issue the session cookie |
| `GET` | `/api/restaurant-session` | Check staff dashboard access |
| `GET` | `/api/restaurants/{restaurantSlug}` | Get public restaurant information |
| `POST` | `/api/restaurants/{restaurantSlug}/waitlist-entries` | Join a waitlist |
| `GET` | `/api/waitlist-entries/{privateToken}` | Get private customer status |
| `POST` | `/api/waitlist-entries/{privateToken}/cancellations` | Cancel an active entry |
| `GET` | `/api/dashboard` | Load the authenticated restaurant dashboard |
| `PATCH` | `/api/dashboard/waitlist-entries/{actionReference}` | Resolve an active entry |

The repository-root [`openapi.yaml`](openapi.yaml) is the authoritative API
contract. With the backend running, browse it through:

- Swagger UI: `http://localhost:8000/docs`
- Scalar API reference: `http://localhost:8000/redoc`
- Raw OpenAPI document: `http://localhost:8000/openapi.json`

Run `npm run openapi:check` in `backend/` to detect material drift between the
NestJS endpoints and the contract.

## Configuration

Backend configuration is loaded from `backend/.env`.

| Variable | Required | Description | Local value |
| --- | --- | --- | --- |
| `PORT` | Yes | Backend HTTP port | `8000` |
| `SECRET_KEY` | Yes | Secret used to sign staff session cookies | Set a strong local value |
| `FRONTEND_ORIGIN` | Yes | Exact origin allowed by credentialed CORS | `http://localhost:4200` |
| `DATABASE_URL` | Yes | SQLite database URL | `sqlite://./data/waitlist.sqlite` |

The frontend API URL is currently a compile-time local value in
`front/src/app/api-base-url.ts`. If the backend port or host changes, update
that value and keep `FRONTEND_ORIGIN` aligned with the frontend origin.

## Persistence and lifecycle

- Runtime accounts, verification tokens, active entries, and resolved entries
  are stored in `backend/data/waitlist.sqlite` by default.
- TypeORM creates and synchronizes the local schema on startup; migrations are
  not part of this MVP.
- Demo data is inserted only when the demo restaurant does not already exist,
  so restarting the backend does not overwrite persisted changes.
- Resolved entries from earlier server-local dates are removed at startup and
  by the scheduled daily cleanup. Active entries are preserved.
- Queue positions are calculated from active entries in FIFO order.
- A normalized phone number can have only one active entry per restaurant.

For a clean local reset, stop the backend and remove the SQLite database and
its adjacent `-shm` or `-wal` files from `backend/data/`. The next backend start
recreates the schema and seed data. Do not remove database files while the API
is running.

## Security and privacy model

This repository is configured for local development, not production
deployment.

- Restaurant passwords are hashed with Argon2.
- Staff access uses a signed, HttpOnly, SameSite=Lax session cookie.
- Customer status tokens and staff action references are opaque capabilities;
  they should not be logged, published, or reused as database identifiers.
- Private status responses expose only the restaurant, queue position, or final
  status, not customer contact details.
- Protected dashboard operations are scoped to the restaurant represented by
  the signed cookie.
- CORS accepts credentialed browser requests only from `FRONTEND_ORIGIN`.

Before production use, deployment configuration, HTTPS cookie settings,
secret management, migrations, account recovery, operational monitoring, and
production data-retention requirements would need to be defined.

## Testing and quality checks

Run backend checks from `backend/`:

```powershell
npm test
npm run lint
npm run format:check
npm run openapi:check
npm run build
```

Run frontend checks from `front/`:

```powershell
npm test
npm run build
```

The frontend test command launches Karma and requires an available Chrome
environment. The backend test suite runs serially through Jest.

## Docker quick start

Create the local backend environment file and set a strong signing secret:

```powershell
Copy-Item backend/.env.example backend/.env
```

Then build and start the two-container stack:

```powershell
docker compose build
docker compose up -d
docker compose ps
docker compose logs backend
```

The application remains available at `http://localhost:4200`, with the API at
`http://localhost:8000`. Rebuild after source changes with
`docker compose up -d --build`. Use `docker compose down` to stop the stack
without deleting data. `docker compose down -v` is a destructive reset that
deletes the persistent SQLite volume. The backend uses `TZ=Asia/Tehran` so
server-local daily cleanup follows this workspace's local day boundary.

## Additional documentation

- [`backend/README.md`](backend/README.md) - backend setup and commands
- [`front/README.md`](front/README.md) - frontend setup, routes, and commands
- [`doc/plan.md`](doc/plan.md) - frozen MVP product specification
- [`doc/process.md`](doc/process.md) - project work process
- [`_docs/backend-tasks.md`](_docs/backend-tasks.md) - backend task history
