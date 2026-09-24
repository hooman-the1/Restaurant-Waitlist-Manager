# Restaurant Waitlist Manager — Lightweight Dockerization Specification

**Status:** Implementation-ready Dockerization scope (no application features added)  
**Basis:** The uploaded project `README.md`, as provided for this task  
**Target:** Reproducible, lightweight **local** Docker setup for the application as it exists today

> This specification defines what to implement and how to verify it. It does **not** claim that Dockerfiles or Compose configuration have already been created or tested. The README is the only supplied repository file; implementation must inspect the real package scripts, Angular output configuration, NestJS bootstrap, and runtime filesystem paths before choosing exact `COPY` paths and start commands.

---

## 1. Objective and scope boundary

Containerize the existing Restaurant Waitlist Manager without redesigning its application, changing its API, or turning this local prototype into a production deployment.

**In scope:** Two small runtime containers, reproducible builds, a single Compose command to start the app, persistent SQLite storage, existing local URLs, browser-cookie authentication, SPA deep links, basic documentation, and container-specific smoke tests.

**Out of scope:** New product features; rewriting the frontend/backend; migrating the database; introducing a database server; production hosting, TLS, cloud services, CI/CD, monitoring stacks, Kubernetes, dev hot-reload containers, or a separate reverse-proxy service.

### Actual stack — source of truth

| Area | Existing implementation | Dockerization treatment |
| --- | --- | --- |
| Frontend | Angular 16, TypeScript, RxJS, standalone components in `front/` | Build static assets in a temporary Node build stage; serve them from a small web-server image. |
| Backend | NestJS 11, TypeScript, Express in `backend/` | Compile in a temporary Node build stage; run compiled JavaScript in a lean Node runtime image. |
| Database | TypeORM + SQLite via `better-sqlite3` | **No database container**; preserve the database in one Docker named volume. |
| Authentication | Signed, HttpOnly, SameSite=Lax browser cookie | Preserve the current cookie and credentialed-CORS behavior. |
| API contract | Repository-root `openapi.yaml`; Swagger UI and Scalar | Preserve routes and docs; do not generate a new API surface. |
| Tests | Jasmine/Karma frontend; Jest/Supertest backend | Preserve the existing tests; do not ship browser/test tools in runtime images. |

**Do not use the older planning document's proposed FastAPI, SQLAlchemy, `uv`, or `frontend/` layout.** The README documents an already-developed **NestJS + TypeORM + `front/`** codebase.

---

## 2. Final lightweight architecture

```text
Browser on developer's machine
    |
    | http://localhost:4200
    v
[frontend container: static Angular files + small web server]
    |
    | Browser calls http://localhost:8000/api/... directly
    v
[backend container: compiled NestJS application]
    |
    v
[SQLite file: /app/data/waitlist.sqlite]
    |
    v
[one persistent Docker named volume]
```

Compose runs **exactly two application services**:

1. `frontend`: serves a compiled Angular SPA as static files; no Angular CLI dev server in the runtime image.
2. `backend`: serves the existing NestJS HTTP API and owns the SQLite database directory.

There is **no** PostgreSQL/MySQL service, Redis, queue worker, third reverse-proxy container, or extra volume for frontend code.

### Preserve existing browser-facing URLs

| Purpose | Local URL |
| --- | --- |
| Angular app | `http://localhost:4200` |
| NestJS API | `http://localhost:8000/api` |
| Swagger UI | `http://localhost:8000/docs` |
| Scalar reference | `http://localhost:8000/redoc` |
| OpenAPI JSON | `http://localhost:8000/openapi.json` |

Publish the host ports using loopback-only mappings for this local-only project:

- Frontend: `127.0.0.1:4200:80` if its web server listens on port `80` inside the container.
- Backend: `127.0.0.1:8000:8000`.

The frontend's existing compile-time API URL in `front/src/app/api-base-url.ts` may stay `http://localhost:8000` **provided the compiled browser bundle already uses that exact URL and works in Docker**. The browser, not the frontend container, makes API requests; therefore **do not replace this URL with `http://backend:8000`**. Docker service names are for container-to-container traffic, not URLs resolved by the host browser.

This is deliberately a **two-origin local setup**, as in the README; do not add an Nginx `/api` proxy or refactor the app to same-origin routing for this task.

---

## 3. Required deliverables

| File/change | Purpose |
| --- | --- |
| `compose.yaml` (repository root) | Define and start exactly two services plus one persistent named volume. |
| `backend/Dockerfile` | Multi-stage compiled NestJS build and minimal Node runtime image. |
| `front/Dockerfile` | Multi-stage Angular production build and static-file runtime image. |
| `front/nginx.conf` or equivalent small web-server config | Support Angular routes by falling back to `index.html`; listen on the chosen internal port. |
| Root `.dockerignore` | Keep unnecessary files/secrets out of the backend's root build context, while preserving files genuinely required by its build. |
| `front/.dockerignore` | Keep frontend build context small and exclude local dependencies/build outputs/secrets. |
| `README.md` — short Docker section | Document setup, start, logs, rebuild, stop, persistence, and destructive reset. |

The backend build should use the repository root as its Docker build context **if** the runtime/build needs the root `openapi.yaml`; otherwise choose the narrowest context that still contains every required file. The frontend build context can be `./front`.

**Deliver only the smallest set of files and application-code changes needed to make these requirements work.** No generated `node_modules`, built assets, SQLite files, `.env`, or secrets should be committed.

---

## 4. Backend image requirements

### 4.1 Multi-stage build

- Use a supported, compatible Node version satisfying the README's documented runtime minimums: Node 20.19+ or Node 22.13+. Prefer one **Node 22 Debian slim** image family for build and runtime unless inspection or an actual build proves a compatibility issue.
- Confirm that the *current project dependencies and build scripts* work with the chosen version; the supplied README does not prove the Docker image has been tested.
- Use `npm ci` with an existing committed `backend/package-lock.json`; do not silently switch to `npm install` or generate a new lockfile during image build.
- Build the NestJS application inside a temporary build stage, using the repo's real build script.
- Run **compiled JavaScript** in the final image, not a watcher, `ts-node`, `nest start --watch`, or a TypeScript development server.
- Determine the actual compiled entry point from the repository's scripts and build output; do not assume `dist/main.js` without checking.
- Final image contains only files needed at runtime: compiled application, production dependencies, essential package metadata, and any actually required static/API-contract assets.
- Omit test tools, TypeScript compiler, Nest CLI, repository docs, caches, build-only packages, and source files not required at runtime.

### 4.2 SQLite native-module compatibility

`better-sqlite3` contains native code. Its installed/built binary must match the Node ABI, CPU architecture, and OS/runtime libc in the final image.

- Use the **same Node major version and compatible Debian/glibc base family** in dependency-build and runtime stages.
- Avoid mixing an Alpine/musl backend builder with a Debian/glibc runtime (or vice versa).
- If native compilation requires Python, Make, or a compiler, install those **only in a build stage**; never carry them into the final runtime image.
- Copy/install production dependencies in a way that keeps the compatible `better-sqlite3` binary functional.
- Prefer a normal slim base over aggressive Alpine optimization that introduces native-module fragility.

### 4.3 Runtime

- Backend process listens on `0.0.0.0:8000` **inside the container**; ensure the actual NestJS bootstrap allows this.
- Keep `PORT=8000`.
- Set the runtime working directory so `DATABASE_URL=sqlite://./data/waitlist.sqlite` resolves to the **mounted persistent directory**. A straightforward target is working directory `/app` and file `/app/data/waitlist.sqlite`.
- Ensure `/app/data` exists and the runtime process can write to it and create SQLite sidecar `-wal` / `-shm` files if used.
- Prefer a non-root runtime user when straightforward; do not defeat data-directory permissions with world-writable `chmod 777`.
- Run the existing database initialization, conditional seed logic, startup cleanup, and scheduled daily cleanup **exactly as before**.
- Do not add a second backend replica or a second process simultaneously writing the same SQLite file.
- Do not add a separate migrations step; the README says TypeORM synchronizes the local schema on startup.

### 4.4 Runtime API and verification

Preserve every documented endpoint, including the existing `/api` routes, `/docs`, `/redoc`, and `/openapi.json`. Preserve the current one-time verification link printed to backend stdout, accessible through `docker compose logs backend`.

Do not change the API contract or the business logic to accommodate Docker.

---

## 5. Frontend image requirements

- Build Angular assets in a temporary Node build stage using the existing project scripts/configuration.
- Use the existing frontend lockfile with `npm ci` if one is committed. If no lockfile exists, **first** generate and commit a valid frontend lockfile as a small, explicit preparatory change; do not rely on nondeterministic dependency resolution during normal Docker builds.
- Inspect `front/angular.json` / actual build output to determine the correct static asset directory. **Do not guess the `dist/` subpath.**
- Serve only the compiled static assets from a lean, maintained web-server image (for example, Nginx Alpine); **do not ship Node, Angular CLI, npm, or frontend source into the runtime image**.
- Web server responds on internal port `80`, mapped to host `4200`, unless inspection establishes a smaller equally simple alternative.
- Support SPA deep links by serving `index.html` for client routes not matching actual static files; missing actual assets must not silently return HTML as a successful JavaScript/CSS response.
- Preserve these browser routes across direct navigation and refresh:
  - `/signup`
  - `/verify/:token`
  - `/dashboard`
  - `/restaurants/:slug`
  - `/status/:token`
- Preserve the application's own unknown-route/not-found behavior.
- Do not add server-side rendering, an Angular development server, hot module reloading, frontend proxying, or a third web-server service.

**Privacy detail:** Customer status and verification tokens can occur in URL paths. Configure the static server not to write token-bearing request paths to access logs; turning its access log off is an acceptable minimal local solution. Do not introduce new logs that expose private customer tokens or staff action references.

---

## 6. Compose configuration

The root `compose.yaml` must:

1. Declare exactly the `frontend` and `backend` services.
2. Build both images from local source; no registry publication or image push required.
3. Publish `127.0.0.1:4200:80` for frontend and `127.0.0.1:8000:8000` for backend, subject to the verified internal listener ports.
4. Put both services on Compose's default network; no custom networks required.
5. Declare **one** named Docker volume (suggested name: `waitlist_data`) mounted at backend `/app/data` or the verified equivalent matching the SQLite URL.
6. Read backend runtime configuration from existing local `backend/.env`; do not bake secrets into the image or include them in `compose.yaml` literals.
7. Retain a stable `SECRET_KEY` across rebuilds/recreates, so signed browser sessions are not invalidated just because the container is replaced.
8. Keep `FRONTEND_ORIGIN=http://localhost:4200`, credentialed CORS, `PORT=8000`, and the SQLite URL aligned with the chosen port/working directory/volume.
9. Use a simple startup dependency if useful, but **do not confuse `depends_on` with proof of backend readiness**. Frontend must handle an API temporarily unavailable during boot, as it does during local startup.
10. Avoid unnecessary Compose features: no extra databases, test containers, init jobs, shared source bind mounts, watch mode, custom networks, production orchestrator configuration, or per-service persistent volumes beyond the SQLite volume.

### Backend `.env`

The README documents these existing variables:

```dotenv
PORT=8000
SECRET_KEY=<strong-local-secret-entered-by-developer>
FRONTEND_ORIGIN=http://localhost:4200
DATABASE_URL=sqlite://./data/waitlist.sqlite
```

The placeholder is documentation only; the real secret must be supplied locally, never committed. Reuse `backend/.env.example` to explain how to make `backend/.env`. Do not add new mandatory configuration variables without a demonstrated need.

### Timezone and daily cleanup

The app's existing daily retention/cleanup rules use **server-local dates**. Inside Docker, the *container* timezone may differ from the developer's host timezone. Inspect the actual cleanup/date code and verify the intended local-day cutoff. If preserving a specific local timezone requires configuration, document the smallest working `TZ` setting for the backend; do not assume Docker automatically inherits the Windows host timezone. Do not rewrite date handling or add a timezone service.

---

## 7. Persistent storage and data lifecycle

- Docker database location is the mounted backend directory; it is **not** a database file inside a disposable container filesystem layer.
- Keep SQLite database and any `-wal` / `-shm` sidecars on the **same** volume and filesystem.
- Rebuilding images, restarting services, recreating containers, and `docker compose down` followed by `up` must **not** delete persisted restaurant accounts or active entries.
- Restart must not reseed an existing database or overwrite changes.
- Current scheduled and startup cleanup still delete prior-day resolved entries while preserving active entries.
- Avoid overlapping a local non-Docker backend process with the Docker backend against the same SQLite file.

### Existing host database: explicit boundary

The README's default host database is `backend/data/waitlist.sqlite`; the Compose named volume is a **different storage location**. First-time Docker startup will normally initialize a fresh database with demo data. **Do not silently copy, overwrite, or import the user's existing host database.** Import/migration of an existing host database is out of scope and must be separately authorized and specified if needed.

### Destructive reset

- `docker compose down` is non-destructive for the named data volume.
- `docker compose down -v` deletes the Compose-managed data volume; document it as an **explicit, destructive reset** and never run it as part of routine rebuild or shutdown.
- Never delete or overwrite `backend/data/waitlist.sqlite` on the host as a side effect of Dockerization.

---

## 8. Authentication, CORS, and secrets

- Preserve signed `restaurant_session` browser-cookie authentication.
- Preserve `HttpOnly` and `SameSite=Lax` behavior.
- Preserve credentialed frontend requests from `http://localhost:4200` to `http://localhost:8000`.
- Preserve the backend's exact allowed origin via `FRONTEND_ORIGIN`; do not use a wildcard origin with credentials.
- For this documented HTTP-only local setup, do not force a `Secure` cookie that would break the existing development flow. HTTPS and production cookie/security changes remain **outside this Dockerization scope**.
- Keep Argon2 password hashing and all existing authorization checks unchanged.
- Keep `.env`, real signing secrets, SQLite files, private tokens, and node_modules out of images where unnecessary and out of source control.
- Do not display full environment variables, cookie values, private tokens, or signing secrets in startup logs or documentation.
- Publish ports to loopback only: the setup is not intended to be publicly reachable.

**No new login, logout, recovery, permission system, or security architecture is part of this work.** This does not make the prototype suitable for production.

---

## 9. Build-context and image-size rules

- Multi-stage builds are **required for both services**.
- Use lean runtime bases: compatible Debian slim Node for backend; small static web server for frontend.
- Runtime backend has production npm dependencies only; runtime frontend contains static assets and web-server runtime only.
- Use Docker build cache effectively: copy package manifests/lockfiles and install dependencies before copying frequently changed application source, wherever possible.
- Use only the dependencies required for the existing project; avoid unnecessary utilities or extra package managers in final images.
- `.dockerignore` excludes at least: `node_modules/`, `dist/` and other generated build outputs, Git metadata, test reports, test coverage, local SQLite data and sidecars, and local `.env` files. Keep `.env.example` and contract/build files **when needed**.
- Avoid `COPY . .` into final runtime stages; selectively copy compiled artifacts and verified runtime requirements.
- Do not pursue a hard image-size number at the cost of breaking native SQLite, Angular routing, or the app's existing behavior. Record actual image sizes after building to spot obvious avoidable bloat.

---

## 10. Implementation sequence (small, testable increments)

1. Inspect actual repository: `backend/package.json`, `front/package.json`, lockfiles, `front/angular.json`, NestJS bootstrap, backend data-path handling, existing `.env.example`, and use of root `openapi.yaml` at build/runtime.
2. Confirm local host build/test commands and existing frontend API URL behavior **before** changing Docker configuration.
3. Add frontend Dockerfile, minimal SPA web-server config, and frontend `.dockerignore`; build and verify Angular direct-route refresh.
4. Add backend Dockerfile and root `.dockerignore`; build and verify compiled NestJS API, native `better-sqlite3`, startup, and file permissions.
5. Add `compose.yaml`, backend `.env` wiring, loopback port mappings, and named SQLite volume.
6. Verify signup, verification via backend logs, cookie-authenticated dashboard, public join, private status, cancellation, FIFO/status changes, and API docs.
7. Verify restart/rebuild preserves data and existing cleanup behaves correctly, including server-local date boundaries.
8. Run the existing frontend/backend checks and add the smallest useful Docker-specific automated checks or repeatable smoke-test instructions.
9. Add a short Docker section to the existing README; do not replace its non-Docker quick-start instructions.

Do not change business behavior to satisfy infrastructure tests. If inspection reveals the implementation differs from the README, document the discrepancy and adapt the Docker-specific implementation to the **real code** while keeping the frozen application scope intact.

---

## 11. Acceptance criteria (pass/fail)

### Build and startup

- [ ] From the repository root, `docker compose build` builds both images successfully on the developer's supported Docker environment.
- [ ] `docker compose up -d` starts exactly two running app containers and one declared persistent named volume; no separately managed database service is needed.
- [ ] Backend executes compiled JavaScript, not a development watcher.
- [ ] Frontend serves compiled static Angular assets, not an Angular dev server.
- [ ] Final frontend image does not contain Node/npm/Angular CLI solely to serve static files.
- [ ] Final backend image excludes development/test-only dependencies and build toolchains.
- [ ] `better-sqlite3` loads and performs database reads/writes successfully inside the running backend container.

### Browser and API

- [ ] `http://localhost:4200` loads the frontend.
- [ ] Direct navigation **and page refresh** work for `/signup`, `/dashboard`, `/restaurants/demo-restaurant`, and `/status/:token` (with a valid token).
- [ ] `http://localhost:8000/docs`, `/redoc`, and `/openapi.json` work as documented.
- [ ] The browser reaches the API at the documented local URL; no browser request depends on resolving the Compose service name `backend`.
- [ ] Browser requests using credentials pass existing CORS checks without widening CORS to all origins.
- [ ] A restaurant can sign up; the one-time verification URL is available via `docker compose logs backend`; opening it in the browser establishes the normal signed staff session.
- [ ] Authenticated dashboard operations work; unauthenticated protected endpoints remain protected.
- [ ] A customer can join, see their position, refresh/auto-refresh status, cancel, and observe the final status where applicable.
- [ ] Existing FIFO, duplicate-active-phone, status-change, and current-day history behavior stays unchanged.

### Data and lifecycle

- [ ] SQLite file is in the mounted backend volume; a disposable container filesystem layer is not its sole copy.
- [ ] Restart/recreate/rebuild preserves existing accounts and active entries; the demo seed does not overwrite the existing database.
- [ ] Prior-day resolved entries are cleaned according to current rules while active entries survive the day boundary.
- [ ] Routine `docker compose down` does **not** delete the named volume.
- [ ] Documentation clearly identifies `docker compose down -v` as destructive.
- [ ] Existing host `backend/data/` is not overwritten or imported automatically.
- [ ] Backend writes successfully as the selected runtime user without unsafe blanket filesystem permissions.

### Regression and documentation

- [ ] Existing backend commands pass: `npm test`, `npm run lint`, `npm run format:check`, `npm run openapi:check`, and `npm run build`.
- [ ] Existing frontend commands pass: `npm test` (with Chrome available) and `npm run build`.
- [ ] Docker build logs/runtime access logs do not newly expose secret values or token-bearing customer/verification paths.
- [ ] Root README includes the minimal Docker workflow and explains the separate named volume, backend log-based verification URL, stop/restart, and explicit destructive reset.
- [ ] Existing non-Docker development instructions remain usable.

**Verification status at specification creation:** Not executed. The supplied material contains only `README.md`, not the buildable repository, so these are implementation acceptance criteria rather than claims of completed testing.

---

## 12. Minimal documented operator workflow

Show the following commands in the README after the configuration files actually exist and have been tested:

```powershell
# Repository root; first create backend/.env from backend/.env.example
# and set a strong local SECRET_KEY.
docker compose build
docker compose up -d

# The verification link is printed in backend logs.
docker compose logs backend

# Inspect containers / rebuild after code changes.
docker compose ps
docker compose up -d --build

# Stop containers while retaining the database volume.
docker compose down

# DESTRUCTIVE: remove Compose-managed persistent data (only when intended).
docker compose down -v
```

Keep existing application URLs unchanged: frontend `http://localhost:4200`, backend `http://localhost:8000`.

---

## 13. Definition of done

Dockerization is complete only when **all applicable acceptance criteria pass**, the two-container stack reproduces the current local app behavior, SQLite survives routine container replacement, and the Docker instructions can be followed from a fresh checkout with Docker, Compose, and a locally created `backend/.env`.

**Scope freeze:** Do not add unrelated features or production infrastructure during this work. Any newly discovered mismatch with actual repository code must be resolved with the smallest necessary Docker-specific adaptation and documented explicitly.
