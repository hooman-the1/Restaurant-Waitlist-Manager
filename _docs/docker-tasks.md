# Dockerization Task Backlog

## 1. Set up project scaffold and passing baseline
Goal: Establish a minimal repo state where Docker tooling exists and one automated check passes.
Description: Add a no-op `compose.yaml` placeholder (with a `version`/empty services block) and a root `.dockerignore` that excludes `node_modules`, `dist`, `.env`, and SQLite files. Create or locate one simple automated check (e.g., a one-line smoke test script or an existing lint/test command) and confirm it passes against the unmodified repo so every later task has a green starting line.

## 2. Inspect repository inputs for Docker builds
Goal: Record exact build entry points, scripts, and file locations for both apps.
Description: Read `backend/package.json`, `front/package.json` and their lockfiles, `front/angular.json`, the NestJS bootstrap file, how `DATABASE_URL` resolves to `/app/data/...`, and where the root `openapi.yaml` is referenced. Record decisions about Node major version, internal listener ports, compile entry points, and Angular `dist/` subpath so each later task can reference verified facts instead of README guesses.

## 3. Generate and commit the frontend lockfile if missing
Goal: Ensure deterministic, reproducible frontend dependency resolution.
Description: Check whether a committed frontend lockfile exists. If not, run `npm install` to produce a stable `front/package-lock.json`, commit only that lockfile, and confirm `npm ci` succeeds. This removes nondeterministic dependency resolution from later Docker builds.

## 4. Create the frontend Dockerfile
Goal: Define a multi-stage build that produces a small image serving compiled Angular assets.
Description: Create `front/Dockerfile` using a Node build stage that runs `npm ci` then `npm run build`, and a lean static-server runtime stage (e.g., nginx:alpine) that serves only the compiled asset directory discovered in task 2. Do not run it yet; this task ends with the file committed.

## 5. Create the frontend .dockerignore
Goal: Keep the frontend build context small and exclude local dependencies/build outputs/secrets.
Description: Create `front/.dockerignore` excluding `node_modules`, local `dist/`, `.env`, `nginx.conf` drafts if any, and editor/Git artifacts. This task ends with the file committed.

## 6. Build and smoke-test the frontend image locally
Goal: Verify the frontend image builds and serves compiled assets.
Description: Run `docker build -f front/Dockerfile front` and confirm it exits zero with the correct artifact path copied into a temporary container (`docker run --rm` and `ls` the static root). Then run the image on a local port and confirm `http://localhost:4200` returns the Angular app's initial HTML without running the build again.

## 7. Configure SPA route handling in the frontend web server
Goal: Support direct navigation and refresh on all Angular routes.
Description: Add or edit `front/nginx.conf` (or equivalent small web-server config) so the static server returns `index.html` for client routes (`/signup`, `/verify/:token`, `/dashboard`, `/restaurants/:slug`, `/status/:token`) that do not map to a real asset, while still returning 404s for missing assets. Confirm `/status/:token` paths do not appear in access logs; acceptable minimal option is disabling the access log.

## 8. Verify frontend deep-link refresh behavior
Goal: Confirm SPA routes survive browser refresh against the running frontend image.
Description: With the image from task 6 running, open each documented route (`/signup`, `/dashboard`, `/restaurants/demo-restaurant`, `/status/:token` with a valid token), refresh each, and confirm no 404s for valid routes while unknown routes still show the not-found page. Document the verified internal port and host port before proceeding.

## 9. Create the backend Dockerfile
Goal: Define a multi-stage build producing a lean Node image running compiled NestJS with working native SQLite.
Description: Create `backend/Dockerfile` using a Node 22 Debian-slim build stage that runs `npm ci` and the repo's real build script, plus a slim Debian runtime stage that keeps only compiled output, production dependencies, and required assets (root `openapi.yaml` only if proven needed at runtime). Ensure `better-sqlite3`'s native binary matches the Node ABI/arch/libc across stages. Do not run it yet; this task ends with the file committed.

## 10. Create the root .dockerignore
Goal: Keep the backend's root build context small and exclude secrets/build outputs/caches.
Description: Create a root `.dockerignore` that excludes `node_modules`, `dist`, build outputs, `.env` (keep `.env.example`), local SQLite files and sidecars, test reports/coverage, `.git`, and editor artifacts, while preserving files genuinely required by the backend build. This task ends with the file committed.

## 11. Build and smoke-test the backend image locally (container only)
Goal: Confirm the backend image builds and the compiled API starts.
Description: Run `docker build -f backend/Dockerfile -t rwm-backend .` (root context) and confirm it exits zero. Then run the container with a strong local `SECRET_KEY`, an ephemeral throwaway `DATABASE_URL` pointing to a temp local directory (not the host `backend/data/`), and confirm the HTTP API starts on `0.0.0.0:8000`.

## 12. Configure backend runtime directory and permissions
Goal: Ensure SQLite writes to the mounted volume with a non-root user.
Description: In `backend/Dockerfile`, create `/app/data`, set ownership to a non-root runtime user, make `/app` the working directory so `DATABASE_URL=sqlite://./data/waitlist.sqlite` resolves to the volume mount, and avoid `chmod 777`. Build and run the image with an ephemeral volume and confirm the SQLite file and any `-wal`/`-shm` sidecars are created in the mounted directory and are writable by the non-root user.

## 13. Verify backend API docs, seed data, and verification logging
Goal: Confirm compiled NestJS API, Swagger UI, Scalar, OpenAPI JSON, and seed data work.
Description: Using the backend image from task 11 on a local port, hit `http://localhost:8000/docs`, `/redoc`, `/openapi.json`, and the seeded public restaurant lookup. Confirm the one-time verification URL prints to backend stdout. This task must use a throwaway database, not the user's existing host `backend/data/`.

## 14. Create the root compose.yaml with services, ports, and volume
Goal: Enable a single command to start a two-container stack.
Description: Create repository-root `compose.yaml` declaring exactly `frontend` and `backend` services plus one named volume (`waitlist_data`), loopback port mappings `127.0.0.1:4200` and the verified internal frontend port, `127.0.0.1:8000:8000` for backend, build contexts, and an env-file reference to `backend/.env`. Do not bake secrets into Compose literals and do not add extra databases or bind mounts. This task ends with the file committed.

## 15. Wire backend .env and stable SECRET_KEY into Compose
Goal: Reuse the existing local .env so sessions survive container replacement.
Description: Ensure `compose.yaml` references `backend/.env` (or `backend/.env.example` with documented overrides), keeps `PORT=8000`, `FRONTEND_ORIGIN=http://localhost:4200`, the SQLite URL aligned to the volume mount, and a stable `SECRET_KEY` supplied by the developer. Provide short instructions in the README or a `.env.example` note for setting `SECRET_KEY`. This task ends with env wiring committed.

## 16. Verify Compose startup and container status
Goal: Confirm `docker compose build` and `up` start exactly two services.
Description: Run `docker compose build` and `docker compose up -d`, then `docker compose ps` to confirm exactly two running app containers and the named volume is created. Do not perform functional tests yet; this task ends with a running stack.

## 17. Verify staff signup, verification, and session persistence
Goal: Confirm restaurant signup, log-based verification, and cookie survival across restarts.
Description: Starting from the running stack in task 16, sign up a new restaurant via the frontend, open the verification link printed in `docker compose logs backend`, and confirm the signed `restaurant_session` cookie is established. Then `docker compose down`/`up` and confirm the cookie/session is still valid for the same account (sessions survive container replacement because `SECRET_KEY` is stable).

## 18. Verify customer join, position, refresh, cancel, and final status
Goal: Validate the public waitlist customer journey end to end.
Description: Using the running stack, join a restaurant's waitlist, confirm the private status URL shows the queue position, refresh/auto-refresh the private status page, cancel the entry from the status page, and confirm the final status appears. Also confirm duplicate-phone join is rejected (409) and FIFO ordering is reflected in the dashboard.

## 19. Verify dashboard auth scope and unauthenticated rejection
Goal: Confirm staff dashboard works when authed and stays protected when not.
Description: With no `restaurant_session` cookie, confirm protected dashboard endpoints return 401 and that no other restaurant's entries are visible. With a valid cookie, confirm the dashboard loads only the authenticated restaurant's active entries (FIFO) and resolved-today entries.

## 20. Verify API docs and localhost-only CORS behavior
Goal: Confirm Swagger UI, Scalar, OpenAPI JSON, and credentialed CORS work locally.
Description: With the stack running, confirm `http://localhost:8000/docs`, `/redoc`, and `/openapi.json` load. From the browser on `http://localhost:4200`, confirm API requests succeed with credentials and pass the frontend origin's CORS check without widening CORS to all origins or exposing the `backend` service name to the browser.

## 21. Verify SQLite native module and writes inside the backend container
Goal: Confirm `better-sqlite3` performs database reads/writes inside the running backend container.
Description: Against the running backend container with the Compose volume, complete a signup + join flow and confirm the SQLite database file plus any `-wal`/`-shm` sidecars exist inside the mounted volume and contain updated rows. Confirm a rebuild with the native module does not break the existing volume's database.

## 22. Verify data persistence across restart/rebuild
Goal: Confirm SQLite survives routine lifecycle events and the seed does not overwrite data.
Description: With data (an account and active entries) in the Compose volume, run `docker compose down` then `docker compose up -d --build` and confirm accounts, active entries, and positions persist. Confirm a previously-unseen seed does not overwrite the existing database (seed runs only when the database is fresh).

## 23. Verify server-local-date cleanup boundaries
Goal: Confirm prior-day cleanup runs inside the container and active entries survive.
Description: Inspect the actual cleanup/date code referenced in task 2. With the stack running, simulate or wait for a day boundary (using `TZ` if the code relies on container-local dates) and confirm prior-day resolved entries are cleaned per current rules while active entries survive. Document the smallest working `TZ` setting for the backend in Compose if one is required.

## 24. Run regression checks (backend)
Goal: Confirm existing backend quality checks still pass.
Description: From `backend/`, run `npm test`, `npm run lint`, `npm run format:check`, `npm run openapi:check`, and `npm run build` against the unmodified repo and confirm all pass before considering Dockerization complete.

## 25. Run regression checks (frontend)
Goal: Confirm existing frontend quality checks still pass.
Description: From `front/`, run `npm test` (with Chrome available) and `npm run build` and confirm both pass against the unmodified repo before considering Dockerization complete.

## 26. Add Docker documentation to README
Goal: Document setup, start, logs, rebuild, stop, persistence, and destructive reset.
Description: Add a short Docker section to the existing `README.md` documenting: creating `backend/.env` from `backend/.env.example`, `docker compose build`, `docker compose up -d`, reading the verification link from `docker compose logs backend`, `docker compose ps`, rebuild after code changes, `docker compose down` (non-destructive), and `docker compose down -v` as the explicit destructive reset. Do not replace the existing non-Docker quick-start instructions.

## 27. Final end-to-end acceptance pass
Goal: Confirm all Docker-specific acceptance criteria pass against the Compose stack.
Description: Re-run the acceptance checks from `doc/docker-plan.md` section 11 (build and startup, browser and API, data and lifecycle, regression and documentation) end to end against `docker compose up -d` and confirm each is green before marking Dockerization complete.
