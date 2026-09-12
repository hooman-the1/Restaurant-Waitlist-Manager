# Backend Backlog

These tasks implement the backend portion of the frozen MVP in `doc/plan.md` against the HTTP contract in `openapi.yaml`. The explicit backend overrides are NestJS instead of FastAPI, NestJS-native tooling and libraries, and an application-scoped in-memory store with seed data instead of database persistence; no task changes the completed frontend in `front/`.

## 1. Initialize the empty NestJS backend
Goal: Create an empty NestJS application in `backend/` with a passing test.
Description: Scaffold a minimal TypeScript NestJS project that can start locally and listen on the API port declared in `openapi.yaml`. Keep it free of product endpoints and domain behavior, and add one smoke test that passes through the configured test command.

## 2. Configure the local backend runtime
Goal: Establish the shared runtime configuration required by every API endpoint.
Description: Add environment-based configuration with a `.env.example` for the signing secret, port, and allowed Angular development origin, using safe local defaults where appropriate. Enable credentialed CORS for the frontend origin, signed-cookie parsing, JSON requests, and NestJS validation that rejects undeclared request properties; cover the configuration with focused bootstrap tests.

## 3. Define the in-memory restaurant and waitlist store
Goal: Provide a typed, application-scoped store for all MVP state.
Description: Model restaurant accounts, single-use verification tokens, active and resolved waitlist entries, private status tokens, opaque staff action references, and server-local timestamps without exposing internal identifiers through API views. Implement deterministic read/write/reset operations suitable for isolated tests, and verify restaurant scoping, FIFO insertion order, and state isolation with unit tests.

## 4. Seed a complete local demo dataset
Goal: Ensure a fresh backend process immediately provides useful data to the existing frontend.
Description: Seed the in-memory store with a verified restaurant, multiple FIFO active entries, same-day resolved entries, and stable documented public, private-status, and staff-session demo access values. Make seeding idempotent within one process and add tests proving the public lookup, active and resolved status cases, and dashboard data are all represented without relying on a database.

## 5. Implement shared normalization and opaque-reference utilities
Goal: Centralize the small domain transformations needed by account and waitlist operations.
Description: Add tested helpers for trimming and collapsing restaurant-name whitespace, case-insensitive restaurant-name and email comparison, slug generation, removal of spaces/dashes/parentheses from phones, and cryptographically strong verification/private/action references. Preserve customer names and displayed phone numbers exactly as submitted, and test edge cases defined in `doc/plan.md`.

## 6. Map validation and failures to the OpenAPI response contract
Goal: Return consistent status codes and response bodies for all expected failures.
Description: Add minimal NestJS DTOs, exception types or filters, and response mapping for the validation, duplicate-phone, unauthorized, not-found, invalid-or-used-token, and unexpected shapes in `openapi.yaml`. Ensure unexpected errors expose only `Something went wrong. Please try again.` and add unit or HTTP tests for each mapping without creating a large DTO architecture.

## 7. Implement restaurant signup
Goal: Create unverified restaurant accounts through `POST /api/restaurants`.
Description: Validate the restaurant name, basic email format, and minimum eight-character password; normalize uniqueness inputs, generate the slug, hash passwords with a NestJS-compatible Argon2 library, and store only the hash. Reject duplicate normalized names, slugs, or emails as specified by `openapi.yaml`, print the one-time local verification URL to the backend console without logging the password, and test successful and rejected requests.

## 8. Implement restaurant verification and session issuance
Goal: Consume a verification token and establish the restaurant browser session.
Description: Implement `POST /api/restaurant-verifications` so a valid unused token verifies its restaurant, becomes unusable, and returns the success body while setting a signed `restaurant_session` cookie. Configure the cookie as HttpOnly, SameSite=Lax, non-Secure, path-wide, and without an explicit expiry, then test valid, missing, invalid, and reused token cases.

## 9. Protect restaurant-only endpoints with signed-cookie authentication
Goal: Make the backend authoritative for restaurant dashboard access.
Description: Implement a reusable NestJS guard that accepts only a valid signed session belonging to a verified restaurant and makes that restaurant available to request handlers. Use it on `GET /api/restaurant-session`, return the exact allowed or unauthorized shapes from `openapi.yaml`, and test missing, tampered, unknown, unverified, and valid sessions.

## 10. Implement public restaurant lookup
Goal: Serve public waitlist page data through `GET /api/restaurants/{restaurantSlug}`.
Description: Look up a restaurant by its generated slug and return only the restaurant name in the success shape defined by `openapi.yaml`. Return the contract's not-found response for unknown slugs, and add HTTP tests that also prove account email and other private fields are never serialized.

## 11. Implement public waitlist joining
Goal: Create active queue entries through `POST /api/restaurants/{restaurantSlug}/waitlist-entries`.
Description: Validate non-empty customer name and phone plus an integer party size from 1 through 30, preserve entered display values, enforce one active normalized phone per restaurant atomically within the in-memory store, and create unguessable private and staff references. Return the exact success, validation, not-found, and duplicate-phone responses from `openapi.yaml`, with tests for normalization, per-restaurant uniqueness, FIFO order, and rejoining only after resolution.

## 12. Implement private customer status lookup
Goal: Return privacy-limited queue state through `GET /api/waitlist-entries/{privateToken}`.
Description: Resolve the opaque token without a restaurant session, calculate a one-based FIFO position for active entries, and return only restaurant name plus position or final status as appropriate. Set `Cache-Control: no-store`, return not found for unknown or cleaned-up tokens, and test position recalculation and the absence of customer name, phone, party size, timestamps, internal IDs, and staff references.

## 13. Implement customer cancellation
Goal: Let a customer immediately cancel an active entry through its private token.
Description: Implement `POST /api/waitlist-entries/{privateToken}/cancellations` as an irreversible transition from active to cancelled with a server-local resolution timestamp. Return the contract's cancellation body, return not found for unknown or already resolved entries, free the normalized phone for a new join, and test the resulting queue-position changes.

## 14. Implement dashboard loading
Goal: Return the authenticated restaurant's active queue and resolved-today data through `GET /api/dashboard`.
Description: Use the signed-session guard to scope all results to one restaurant, return active entries in strict FIFO order with one-based positions and only the fields permitted by `openapi.yaml`, and include entries resolved during the current server-local day. Set `Cache-Control: no-store` and test empty/populated sections, cross-restaurant isolation, field privacy, and exclusion of older resolved entries.

## 15. Implement staff waitlist resolution
Goal: Resolve an active entry through `PATCH /api/dashboard/waitlist-entries/{actionReference}`.
Description: Accept only `seated`, `cancelled`, or `no-show`, require an authenticated restaurant that owns the opaque action reference, and apply the transition immediately with a server-local timestamp. Return validation or not-found results for invalid, foreign, unknown, or already resolved actions, and test all three statuses, irreversible transitions, queue recalculation, and appearance in Resolved Today.

## 16. Implement resolved-entry cleanup
Goal: Remove expired resolved entries at startup and server-local midnight.
Description: Add a NestJS-native scheduled cleanup that permanently removes resolved entries from earlier server-local dates while never deleting active entries, and run the same cleanup once during application startup. Use an injectable clock or equivalent test seam to verify date boundaries, restart cleanup, midnight execution, private-token removal, and preservation of current-day resolved data.

## 17. Publish NestJS API documentation
Goal: Make the implemented NestJS API inspectable while keeping `openapi.yaml` authoritative.
Description: Add NestJS Swagger metadata and local documentation endpoints equivalent to the plan's `/docs` and `/redoc` experience, without introducing API versioning or undocumented product operations. Verify that every operation, cookie security scheme, request, response, and opaque path parameter matches the repository-root `openapi.yaml`, and add a repeatable contract check that fails on material drift.

## 18. Verify the complete seeded backend
Goal: Prove the backend supports every frontend-facing MVP flow as one local in-memory application.
Description: Add focused Supertest scenarios covering signup and verification, signed dashboard access, public lookup and join, private status and cancellation, staff resolution, cleanup, CORS credentials, cache headers, and the documented error shapes. Run the full unit/e2e test suite, lint, formatting check, and production build, and add a concise backend-local developer note describing startup, reset-on-restart behavior, and the seeded demo URLs/tokens without modifying frontend files.
