# Backend

NestJS REST API for the Restaurant Waitlist Manager. It handles restaurant
signup and verification, signed staff sessions, public waitlist operations,
customer status pages, dashboard actions, and SQLite or PostgreSQL persistence.

## Run locally

Requirements: Node.js 20.19+ and npm.

```powershell
cd backend
npm ci
Copy-Item .env.example .env
```

Replace the placeholder `SECRET_KEY` in `.env` with a strong local value, then
start the API:

```powershell
npm start
```

The API runs at `http://localhost:8000` by default. Interactive documentation
is available at:

- Swagger UI: `http://localhost:8000/docs`
- Scalar API reference: `http://localhost:8000/redoc`
- OpenAPI JSON: `http://localhost:8000/openapi.json`

## Configuration

| Variable          | Purpose                               | Default example                   |
| ----------------- | ------------------------------------- | --------------------------------- |
| `PORT`            | API port                              | `8000`                            |
| `SECRET_KEY`      | Signs the `restaurant_session` cookie | No usable default                 |
| `FRONTEND_ORIGIN` | Allowed credentialed CORS origin      | `http://localhost:4200`           |
| `DATABASE_URL`    | SQLite or PostgreSQL connection URL   | `sqlite://./data/waitlist.sqlite` |

The database schema and deterministic demo restaurant are created on startup.
Local data is stored in `backend/data/waitlist.sqlite` and survives restarts.

PostgreSQL is also supported with either a `postgres://` or `postgresql://`
URL, for example:

```text
postgresql://waitlist:waitlist@localhost:5432/waitlist
```

For a local PostgreSQL verification run, start a PostgreSQL 16 instance, set
`DATABASE_URL` to its connection URL, and start the backend. Create a
restaurant or join the seeded waitlist, stop and restart the backend, then
repeat the lookup or dashboard request. Records, one-time token state, FIFO
order, uniqueness constraints, and resolved-entry cleanup state should be
unchanged after restart. The backend recreates the development schema with
TypeORM on startup; it does not run migrations.

## Useful commands

```powershell
npm test
npm run lint
npm run format:check
npm run openapi:check
npm run build
```

The authoritative API contract is [`../openapi.yaml`](../openapi.yaml). See the
[repository README](../README.md) for demo URLs, application flows, and full
project documentation.
