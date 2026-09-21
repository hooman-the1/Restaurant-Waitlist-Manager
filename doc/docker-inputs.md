# Docker build inputs

Verified for Docker issue #44 from the repository files and local build output.

## Backend

- Context: repository root (`.`), because `backend/src/api-documentation.ts` resolves `../../openapi.yaml` from compiled `backend/dist`, so the root contract must be available during the image build and at runtime.
- Package manifest/lockfile: `backend/package.json` and `backend/package-lock.json` (lockfile version 3).
- Install/build commands: `npm ci`, then `npm run build` (`nest build`).
- Compiled entry point: `backend/dist/main.js` (confirmed in the existing build output); runtime command should execute `node dist/main.js`.
- Bootstrap: `backend/src/main.ts` calls `app.listen(configuration.port)`. `PORT` defaults to `8000`; Docker must bind the process to `0.0.0.0` when the runtime image is created.
- Database path: `backend/src/database-configuration.ts` converts `sqlite://./data/waitlist.sqlite` with `resolve(process.cwd(), 'data/waitlist.sqlite')`. With `/app` as the working directory, this is `/app/data/waitlist.sqlite`.
- OpenAPI: `backend/src/api-documentation.ts` reads `resolve(__dirname, '../../openapi.yaml')`; preserve `/app/openapi.yaml` alongside the compiled application (or an equivalent path satisfying that resolution).

## Frontend

- Context: `front/`.
- Package manifest: `front/package.json`; no committed `front/package-lock.json` exists. Issue #45 must create it before deterministic `npm ci` builds.
- Install/build commands: `npm install` until the lockfile exists, then `npm ci`; `npm run build` runs Angular's `ng build`.
- Entry point: `front/angular.json` specifies `src/main.ts`.
- Production output: `front/angular.json` sets `outputPath` to `dist/front`; the static server must serve `front/dist/front` from the build stage.

## Shared decisions

- Node image family: Node 22 Debian slim, satisfying the documented Node.js 20.19+ requirement and the 22.13+ minimum on the Node 22 line in `README.md`, while keeping backend native modules on a Debian/glibc family.
- Internal listener targets: backend `8000`; frontend static server target is `80` per `doc/docker-plan.md` unless a later verified implementation documents otherwise.
- No application, dependency, or lockfile changes are part of this inspection task.
