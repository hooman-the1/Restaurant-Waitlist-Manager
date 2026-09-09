# Restaurant Waitlist Manager — Frozen MVP Specification

## 1. Project Goal

Build a **very lightweight multi-restaurant restaurant waitlist manager**.

The product is a self-service web platform where restaurant owners/managers create a restaurant account, customers join that restaurant's waitlist through a public link, and restaurant staff manage the active queue.

This specification is **frozen**. Only features explicitly selected during the 200-question scoping session are in scope. Anything else is out of scope unless the specification is intentionally reopened later.

---

# 2. Product Scope Summary

## Primary actors

### Restaurant
- A restaurant owner/manager creates the restaurant account.
- Each restaurant has **one account/login identity**.
- Each restaurant has **one active waitlist**.
- The restaurant manages active entries from a dashboard.

### Customer
- Customers do **not** create accounts.
- Customers join through a **public restaurant waitlist URL**.
- Customers provide:
  - Name
  - Phone number
  - Party size
- Customers receive a private status URL after joining.
- The private status page shows the restaurant name and the customer's queue position.
- Customers can cancel their own active entry.

---

# 3. Core User Flows

## 3.1 Restaurant signup

Restaurant provides:
- Restaurant name
- Email
- Password

Rules:
- Email must have a valid basic email format.
- Password must be at least 8 characters.
- Password is securely hashed using `pwdlib` with its recommended secure default.
- Restaurant email addresses must be unique.
- Restaurant names must be unique, case-insensitively.
- Restaurant names are trimmed.
- Repeated internal spaces in restaurant names are collapsed.
- A public URL slug is generated automatically from the restaurant name.
- A duplicate restaurant name/slug causes signup to be rejected.
- Email verification is required before dashboard access.
- No manual platform approval is required.
- No resend-verification flow exists.
- Verification links do not expire before use.
- Verification links are single-use.
- In local development, the verification URL is printed to the backend console instead of being sent by email.
- After verification, the user is redirected directly to the dashboard.

## 3.2 Restaurant authentication/session

- Authentication uses a **signed cookie**.
- No server-side session table.
- Cookie is `HttpOnly`.
- Cookie uses `SameSite`.
- No separate CSRF token.
- Cookie is not `Secure` because this MVP is local-only and HTTPS is not required by the spec.
- Cookie has no explicit expiration and behaves as a browser-session cookie.
- There is **no normal login page**.
- There is **no logout flow**.
- If the browser session is lost, the restaurant loses access to that account.
- A lost account's email cannot be reused because restaurant emails remain unique.
- There is no password-reset flow.

This behavior is intentionally minimal and prototype-oriented.

## 3.3 Customer joins a waitlist

Customer opens the restaurant's public waitlist URL.

The page:
- Shows the restaurant name.
- Uses the restaurant name as the page title.
- Does not show current waitlist size.
- Does not show estimated wait time.
- Does not support QR codes.
- Does not require a customer account.
- Does not require phone verification.
- Does not include CAPTCHA.

Customer enters:
- Name
- Phone
- Party size

Party-size rules:
- Integer only.
- Minimum: 1.
- Maximum: 30.

Phone rules:
- Basic validation only.
- Normalize simple formatting characters before duplicate checking:
  - spaces
  - dashes
  - parentheses
- Do not normalize international country codes or leading `+`.

Customer-name behavior:
- Keep customer names as entered.
- Do not normalize names.
- Duplicate names are allowed.

Duplicate rule:
- One active waitlist entry per normalized phone number per restaurant.
- Duplicate active phone protection exists in backend logic and at the database level.
- If a duplicate active phone is submitted, return a simple error:
  - `This phone number is already on the waitlist.`
- Do not expose or recover the existing private status URL.

Form behavior:
- No client-side validation.
- Backend validation only.
- After a validation error, preserve name, phone, and party size.
- While submitting, disable the submit button and show a simple loading state such as `Joining…`.
- On success, redirect directly to the customer's private status page.

## 3.4 Customer status page

- Private URL uses an unguessable random token.
- Token is generated once and never rotated.
- Internal database IDs are never exposed.
- The page shows:
  - Restaurant name
  - Queue position only while active
- It does **not** show:
  - Customer phone
  - Customer name
  - Party size
  - Join time
  - Estimated wait time
  - “You’re next” special message
- Position is shown simply, e.g. `#1`, `#4`.
- The page auto-refreshes every 30 seconds.
- There is no manual refresh button.
- Auto-refresh stops once the entry becomes resolved.

Resolved statuses:
- Seated
- Cancelled
- No-show

After resolution:
- The private page displays the final status as plain text.
- Once the resolved record is deleted after the daily cleanup, the private URL returns `404 Not Found`.

## 3.5 Customer cancellation

- Customer can cancel their own active waitlist entry from the private status page.
- Cancellation occurs immediately.
- No confirmation dialog.
- Customer may join again later as a new entry.
- Rejoining still follows the active-phone uniqueness rule.

## 3.6 Restaurant dashboard

Dashboard:
- Shows restaurant name as the heading.
- Does not show restaurant email.
- Does not show public waitlist URL.
- Does not show a total active-customer count.
- Does not auto-refresh.
- Staff refreshes manually.

Two sections:
1. **Active**
2. **Resolved Today**

### Active queue

If empty:
- Show `No customers waiting`.

Each active row shows:
- Queue position
- Customer name
- Full phone number
- Party size

It does not show:
- Join time
- Notes

Queue rules:
- Strict FIFO.
- Party size does not affect order.
- Staff cannot reorder.
- Staff cannot sort.
- Staff cannot search/filter.
- No pagination.
- Staff cannot add customers manually.
- Staff cannot edit customer name or phone.
- No customer detail page.
- No table assignment.

Staff changes status using:
- One dropdown/menu.
- Options:
  - Seated
  - Cancelled
  - No-show
- Selecting a status applies immediately.
- No confirmation.
- No separate Apply button.
- No success toast.
- Status changes cannot be undone.
- No hard-delete action.
- No separate “clear waitlist” action.

### Resolved Today

Always visible below Active.

If empty:
- Show `No resolved entries today`.

Each resolved entry shows:
- Customer name
- Party size
- Final status

It does not show:
- Phone number
- Old queue position
- Join time

Resolved statuses use plain text only with no special status colors.

---

# 4. Waitlist Lifecycle

## Active entries
- Remain active until restaurant staff resolves them or the customer cancels.
- Active entries are **not** automatically deleted at midnight.

## Resolved entries
- Statuses:
  - seated
  - cancelled
  - no-show
- Remain visible in `Resolved Today` until cleanup.
- Are permanently deleted after the day ends.
- No soft deletes.
- No long-term history.

## Daily cleanup
- Runs at server-local midnight.
- Implemented as a simple scheduled job inside FastAPI.
- No external scheduler or worker.
- On application startup, also delete resolved entries left over from previous days.
- Application uses the server OS timezone.
- No explicit application timezone setting.
- Database timestamps use server-local time directly, not UTC.

---

# 5. Restaurant Account Rules

- One restaurant account per email.
- One login identity per restaurant.
- No multiple staff accounts.
- No roles such as owner/manager/host.
- Restaurant name and email cannot be edited after signup.
- Restaurant account cannot be deleted through the app.
- No active/inactive flag.
- Every verified account is usable.
- No platform admin dashboard.
- No platform-owner approval workflow.
- No password reset.
- No resend verification.
- No login page.
- No logout flow.

---

# 6. Public Restaurant URL

- Each restaurant receives one public waitlist URL.
- URL slug is automatically generated from restaurant name.
- Restaurant does not choose its own slug.
- Slugs are not random IDs.
- Restaurant names are unique, so slug collision is handled by rejecting the conflicting signup rather than suffixing the slug.
- No QR-code generation.
- Dashboard does not display the public URL.
- Signup flow does not display the public URL.

---

# 7. Queue Rules

- One waitlist per restaurant.
- Waitlist is always open.
- Restaurant cannot pause/close it.
- Restaurant cannot disable/hide the public URL.
- Strict FIFO.
- Party size does not influence queue order.
- Staff cannot reorder.
- Staff cannot sort.
- Customer sees only position.
- No estimated wait time.
- No “people ahead” text beyond the numeric queue position.
- No notifications.
- No email notifications.
- No SMS notifications.
- No table assignment.
- No notes.

---

# 8. Data Retention

Persist:
- Restaurant account data.
- Active waitlist entries.
- Same-day resolved entries until cleanup.

Do not retain:
- Previous-day resolved history.
- Audit logs.
- Soft-deleted records.
- Historical customer records after cleanup.
- Analytics data.

Resolved entries are permanently deleted during cleanup.

---

# 9. Analytics and Reporting

Out of scope:
- Dashboard analytics.
- Customers served today count.
- No-show count.
- Cancellation count.
- Average wait time.
- Daily/weekly trends.
- Peak periods.
- Historical reports.

---

# 10. Notifications and Messaging

Out of scope:
- SMS.
- Email notifications to customers.
- “Table ready” notifications.
- Push notifications.

Email is used only conceptually for restaurant account verification, but in local development the verification URL is printed to console.

---

# 11. Frontend Architecture

## Framework
- Angular.

## App style
- Separate SPA frontend.
- REST API backend.
- Client-side routing enabled.

Suggested routes include:
- Signup
- Verification callback
- Dashboard
- Restaurant public join page
- Customer private status page

## UI
- Plain Angular + simple CSS.
- No Angular Material.
- No UI component library.
- One simple theme.
- No dark mode.
- Mobile responsive.
- Shared simple layout/header component.
- Simple static footer containing only the app name.
- No custom styled 404 page; use a simple generic not-found message.
- Basic semantic HTML and labels only.
- No additional accessibility-specific testing scope.

## Forms
- Template-driven forms.
- No frontend/client-side validation.
- Backend validation only.
- Preserve entered values after validation errors where selected.
- Loading states on API requests.
- Generic fallback error for unexpected failures.
- Backend validation errors can be shown as one generic form-level error rather than field-level errors.

## State management
- No NgRx or other state-management library.
- Use Angular services + component state.
- Use simple API services per domain.
- Use an Angular route guard for restaurant dashboard access.

## Navigation
- Normal browser back behavior only.
- No custom navigation handling.

---

# 12. Backend Architecture

## Framework
- FastAPI.

## Package management
- `uv`.

## ORM
- SQLAlchemy.
- Synchronous SQLAlchemy.
- Keep persistence database-agnostic.
- Avoid database-specific SQL where possible.

Development database recommendation:
- SQLite.

Portability target:
- Keep code portable to databases such as PostgreSQL.

## Models
- Keep SQLAlchemy models in one `models.py` file.

## API structure
- REST API.
- No API versioning.
- Example style: `/api/...`, not `/api/v1/...`.
- Split FastAPI routes into multiple router files, e.g.:
  - `auth.py`
  - `restaurants.py`
  - `waitlist.py`

## Business logic
- No separate service layer.
- No repository layer.
- Route handlers may contain business logic directly.
- Route handlers use an injected SQLAlchemy session.
- Use FastAPI dependency injection for database/session access.

## Schemas
- No separate dedicated Pydantic request/response schema layer.
- Keep the backend model structure minimal.

Implementation note:
FastAPI still uses Pydantic internally for many request/validation mechanisms; this decision means **do not create a large separate DTO/schema architecture unless technically required**.

## Database migrations
- No Alembic.
- During development, recreate the database when schema changes.

## Database transactions
- Rely on normal SQLAlchemy session commit behavior.
- No explicit transaction blocks as a separate architecture requirement.

## CORS
- Configure CORS for the local Angular development origin.

## API documentation
- Keep FastAPI default OpenAPI/Swagger documentation enabled.
- `/docs`
- `/redoc`

## Error responses
- No required global JSON error envelope.
- Endpoints may use their natural FastAPI error responses.

---

# 13. Authentication and Security

## Restaurant authentication
- Signed cookie.
- No JWT.
- No access/refresh tokens.
- No server-side session table.
- Browser-session cookie only.
- `HttpOnly`.
- `SameSite`.
- No `Secure` requirement for this local-only MVP.
- No separate CSRF token.
- Backend authentication is enforced on every restaurant-only endpoint.
- Frontend route guard is UX only; backend remains authoritative.

## Passwords
- Minimum 8 characters.
- No uppercase/lowercase/number/symbol complexity rules.
- Hash with `pwdlib` recommended secure default.
- Never store plaintext passwords.

## Customer privacy
- Private customer status URLs use random unguessable tokens.
- No database IDs exposed to frontend.
- Customer phone is not shown on private status page.
- Customer phone appears in full to restaurant staff in active queue.

## Explicitly excluded
- HTTPS requirement in the app spec.
- Rate limiting.
- CAPTCHA.
- Audit logging.
- Advanced CSRF-token flow.
- Phone verification.

---

# 14. Testing Strategy

## Development method
Use **comprehensive TDD**.

Important areas to develop test-first:
- Restaurant signup.
- Restaurant-name uniqueness.
- Restaurant-email uniqueness.
- Email verification.
- Signed session authentication.
- Customer join flow.
- Phone normalization.
- Duplicate active phone prevention.
- Party-size validation.
- FIFO queue ordering.
- Queue-position calculation.
- Customer cancellation.
- Rejoining after cancellation.
- Staff status changes.
- Resolved-today behavior.
- Midnight cleanup.
- Startup cleanup.
- Private status-token access.
- `404` behavior after resolved entry deletion.
- Protected restaurant endpoints.

## Backend tests
- Include unit/domain tests.
- Include FastAPI endpoint tests using a test client.
- Mock the database layer rather than using a real SQLite test database.
- Do not require a separate integration-test database.

## Frontend tests
- Unit tests only.
- No end-to-end test suite.

## CI
- No CI.
- Tests/checks run locally.

---

# 15. Development Tooling

## Backend
- Ruff only for linting + formatting.
- No Black + Flake8 combination.
- No mypy requirement.
- Basic console logging only.
- No structured JSON logging.

## Frontend
- No additional linting setup beyond Angular defaults.
- No Angular Material.
- No extra ESLint/Prettier requirement beyond defaults selected during scope.

## Environment
Use environment variables for backend configuration.

Include:
- `.env.example`

Likely variables:
- `DATABASE_URL`
- `SECRET_KEY`

## Docker
- No Docker.
- No Docker Compose.
- Run Angular and FastAPI directly.

## CI/CD
- No CI.
- No deployment pipeline.

## Deployment
- Deployment is out of scope.
- Local development only.

## Documentation
- No README yet.
- Documentation can be added later.

## Seed data
- Include seed/demo data.

---

# 16. Repository Structure

Use a single repository:

```text
/
├── front/
│   └── Angular application
└── backend/
    └── FastAPI application
```

No separate repositories.

---

# 17. UI Behavior

## Global
- Responsive on desktop and mobile.
- One simple theme.
- Shared layout/header.
- Static footer with app name only.
- Simple loading indicators.
- Generic fallback error:
  - `Something went wrong. Please try again.`
- No success toasts for staff status actions.

## Dashboard
- Restaurant name heading.
- Active section.
- Resolved Today section.
- No search.
- No filters.
- No sorting.
- No pagination.
- No auto-refresh.
- No active-count badge.
- No public-link display.

## Join page
- Restaurant name.
- Name field.
- Phone field.
- Party size field.
- Submit loading state.
- No notes.
- No queue size.
- No estimated wait.
- No client-side validation.
- No CAPTCHA.

## Status page
- Restaurant name.
- Queue position.
- Auto-refresh every 30 seconds while active.
- Stop refresh once resolved.
- No manual refresh button.
- Final resolved status shown as plain text.

---

# 18. Explicit Out-of-Scope List

Anything not explicitly selected is out of scope. In particular:

- Multiple waitlists per restaurant.
- Multiple staff users.
- Role-based access control.
- Staff invitations.
- Customer accounts.
- Customer login.
- Restaurant login page.
- Logout.
- Password reset.
- Restaurant account recovery.
- Restaurant account deletion.
- Restaurant profile editing.
- Platform admin dashboard.
- Manual restaurant approval.
- Restaurant logos/images.
- Restaurant-page customization.
- Multiple languages.
- Dark mode.
- QR codes.
- SMS.
- Customer emails.
- Push notifications.
- Estimated wait times.
- Wait-time prediction.
- Table management.
- Table assignment.
- Customer notes.
- Staff-added waitlist entries.
- Staff editing customer data.
- Staff queue reordering.
- Queue sorting.
- Queue filtering.
- Queue search.
- Pagination.
- Manual “clear waitlist”.
- Undo status changes.
- Hard-delete action for individual entries.
- Historical waitlist pages.
- Analytics.
- Reports.
- Long-term resolved-entry retention.
- Audit logs.
- Soft deletes.
- Public third-party API.
- API versioning.
- Repository layer.
- Service layer.
- Separate Pydantic schema architecture.
- Async SQLAlchemy.
- Alembic migrations.
- Docker.
- CI.
- Deployment.
- External scheduler/worker.
- Structured logging.
- Rate limiting.
- CAPTCHA.
- Phone verification.
- Country-aware phone normalization.
- Explicit CSRF tokens.
- HTTPS requirement in the prototype spec.
- End-to-end frontend tests.
- Custom styled 404 page.
- Custom browser-navigation handling.
- README for now.

---

# 19. Important Implementation Caveats

These are not scope changes; they document consequences of decisions already made.

## 19.1 Session/account recovery

Because:
- there is no login page,
- the session cookie is browser-session scoped,
- restaurant emails are unique,

losing the browser session means the restaurant cannot recover that account within the MVP.

This is intentional for this prototype.

## 19.2 Database-agnostic requirement vs active-phone uniqueness

The product requires:
- one active entry per normalized phone per restaurant,
- database-level enforcement,
- rejoining after a cancelled entry,
- resolved entries remain until daily cleanup.

A fully database-agnostic implementation of a conditional uniqueness constraint can be awkward because partial/filtered unique indexes vary by database.

Implementation should preserve the business rule while minimizing database-specific behavior. If necessary, the backend check remains authoritative and the DB-level protection can use the simplest portable approach available for the chosen development database.

## 19.3 No separate Pydantic schema layer

FastAPI naturally relies on Pydantic for validation/serialization. “No separate Pydantic schema layer” means:
- do not create a large DTO/schema architecture,
- keep request/response modeling minimal,
- only introduce Pydantic models where FastAPI technically requires or materially benefits from them.

## 19.4 Local-only security posture

This scope intentionally omits:
- HTTPS requirement,
- `Secure` cookies,
- rate limiting,
- CAPTCHA,
- full CSRF-token protection.

Those decisions are acceptable only because the project is explicitly scoped as a lightweight local MVP, not a production deployment.

---

# 20. Frozen Acceptance Boundary

The MVP is complete when the explicitly selected behaviors in this specification work and are covered by the agreed TDD strategy.

**No extra feature should be added during implementation merely because it seems useful.**

If a new feature is desired, the scope must be intentionally reopened first.

---

# 21. Complete Decision Log — Questions 1–200

1. Multi-restaurant platform.
2. Restaurant owner/manager self-signup.
3. Customers join via public link.
4. Initially name + phone; later superseded by Question 56 to name + phone + party size.
5. Customer sees queue position only.
6. Staff can mark seated / cancelled / no-show.
7. One login per restaurant.
8. One waitlist per restaurant.
9. Customers can cancel themselves.
10. Waitlist always open.
11. No customer account.
12. Customer status auto-refreshes periodically.
13. No analytics.
14. Resolved entries remain visible in same-day history.
15. Unique private customer status link.
16. Public link only; no QR.
17. Public page does not show current queue size.
18. Strict FIFO.
19. One active entry per phone number per restaurant.
20. Staff cannot edit customer name/phone.
21. Restaurant signup: name + email + password.
22. Restaurant email verification required.
23. Unresolved active entries remain until resolved.
24. Public slug auto-generated from restaurant name.
25. No password reset.
26. No restaurant account deletion.
27. No platform admin dashboard.
28. Status page initially queue position only.
29. No customer phone verification.
30. Resolved private page shows final status.
31. Restaurant name/email cannot be edited.
32. No explicit login/logout flow selected at this point.
33. Persistent access concept initially based on browser session.
34. Initial session preference: valid until browser data/cookies cleared; later refined by Questions 159–162.
35. No previous-day history.
36. No dashboard search/filtering.
37. One language only.
38. No notifications.
39. No estimated wait time.
40. No table assignment.
41. Public waitlist link always active.
42. No manual restaurant approval.
43. Customers see queue position.
44. Staff cannot manually add customers.
45. Customers may rejoin after cancellation.
46. Resolved entries cleared after midnight.
47. Customer names do not need to be unique.
48. Basic phone validation.
49. Customer cancellation has no confirmation.
50. Staff status actions have no confirmation.
51. No landing page.
52. No restaurant logo/image upload.
53. No public-page customization.
54. No dark mode.
55. Responsive web app.
56. Add party size to join form.
57. No customer notes.
58. Party size does not affect FIFO.
59. Staff sees party size.
60. Customer status page does not show party size.
61. Party size has a maximum.
62. Maximum party size = 30.
63. Staff does not see join time.
64. No undo for status changes.
65. No dashboard sorting.
66. Staff sees full phone number.
67. Customer status page never shows phone number.
68. Resolved history shows name + party size + status.
69. Resolved history does not show old queue position.
70. Dashboard does not auto-refresh.
71. Public join page shows restaurant name.
72. After join, redirect directly to private status page.
73. Empty active queue shows `No customers waiting`.
74. Position #1 has no special “You’re next” message.
75. No separate active-customer count.
76. Signup validation error preserves values except password.
77. Join-form validation error preserves name, phone, party size.
78. Public join page remains accessible to customers already active; duplicate submission is blocked.
79. Duplicate phone error only; do not return status link.
80. No “Clear waitlist” action.
81. Separate Active and Resolved Today sections.
82. No customer detail page.
83. No pagination.
84. Verification links do not expire until used.
85. Verification links are single-use.
86. No resend verification.
87. One restaurant account per email.
88. Duplicate restaurant slug/name causes signup rejection.
89. Restaurant names unique.
90. Restaurant names case-insensitively unique.
91. Trim restaurant-name leading/trailing spaces.
92. Collapse repeated internal spaces in restaurant names.
93. Do not normalize customer names.
94. Normalize phone formatting before duplicate check.
95. Do not normalize country codes/leading plus.
96. HTTPS not required by prototype spec.
97. No rate limiting.
98. No audit log.
99. No third-party/public API.
100. Comprehensive TDD.
101. No deployment; local development only.
102. Include seed/demo data.
103. Local email verification link printed to console.
104. Database-agnostic SQLAlchemy persistence.
105. No migrations/Alembic.
106. Separate SPA frontend + REST API.
107. Angular frontend.
108. FastAPI backend.
109. Cookie-based restaurant authentication.
110. Signed-cookie-only session; no session table.
111. Plain Angular + simple CSS; no UI library.
112. Angular client-side routing.
113. No API versioning.
114. No separate Pydantic schema layer.
115. Single monorepo with `/front` and `/backend`.
116. Backend tests mock database layer.
117. Frontend tests are unit tests only.
118. Backend includes FastAPI endpoint tests.
119. No service layer.
120. Use FastAPI dependency injection for DB/session access.
121. Synchronous SQLAlchemy.
122. No repository layer.
123. Split routes into multiple router files.
124. One `models.py`.
125. Backend config via environment variables.
126. Include `.env.example`.
127. Basic console logging only.
128. No Docker.
129. Enforce lightweight formatting/linting.
130. Ruff only for backend.
131. No extra frontend linting beyond Angular defaults.
132. No CI.
133. No README yet.
134. Keep FastAPI `/docs` and `/redoc`.
135. No required global JSON error shape.
136. Configure local-development CORS.
137. No state-management library; services + component state.
138. Template-driven Angular forms.
139. Simple API service per domain.
140. Angular route guard for dashboard.
141. Backend auth required for restaurant-only endpoints.
142. Customer private status URL uses an unguessable token.
143. Private token never rotates.
144. Deleted resolved entry's private URL returns 404.
145. Active entries are not deleted at midnight.
146. Resolved entries deleted at server-local midnight.
147. Cleanup scheduled inside FastAPI.
148. Startup also cleans old resolved entries.
149. Store server-local timestamps, not UTC.
150. Use server OS timezone; no explicit app timezone.
151. Party size integer 1–30.
152. Basic restaurant email validation.
153. Password minimum 8 characters only.
154. Secure password hashing required.
155. Use `pwdlib` recommended secure default.
156. SameSite cookie; no separate CSRF token.
157. Session cookie is `HttpOnly`.
158. Session cookie not `Secure` for local-only MVP.
159. Browser-session cookie; no explicit expiry.
160. Confirmed browser-session behavior even if browser close may end access.
161. No normal login page.
162. Losing session means losing account access.
163. Keep unique emails despite lost-session consequence.
164. No restaurant active/inactive flag.
165. No separate waitlist-entry delete action.
166. No CAPTCHA.
167. Basic semantic HTML/labels only; no extra accessibility testing scope.
168. Simple loading indicators.
169. Generic unexpected-error message.
170. No staff-action success toasts.
171. Verification redirects directly to dashboard.
172. Dashboard does not show public waitlist URL.
173. Signup does not show public waitlist URL.
174. Dashboard shows restaurant name.
175. Dashboard does not show restaurant email.
176. Restaurant name is public join-page title.
177. Status page shows restaurant name.
178. No manual refresh button on customer status page.
179. Customer status auto-refresh every 30 seconds.
180. Stop polling once resolved.
181. Resolved private page shows final status plain text.
182. Resolved Today section always visible.
183. One status dropdown/menu rather than separate buttons.
184. Status dropdown applies immediately.
185. No special status coloring.
186. Empty resolved section shows `No resolved entries today`.
187. Join submit button disabled/loading while processing.
188. Signup submit button disabled/loading while processing.
189. Backend validation errors shown as one generic form-level message.
190. No client-side validation.
191. Shared layout/header component.
192. Simple static footer.
193. Footer contains app name only.
194. No custom styled 404 page.
195. Normal browser back behavior.
196. Do not expose internal DB IDs to frontend.
197. No soft deletes.
198. Normal SQLAlchemy session commit flow; no explicit transaction architecture.
199. Duplicate active phone protected in backend and database.
200. Scope frozen; anything not selected is out of scope.

---

# 22. Final Technology Snapshot

```text
Frontend:
  Angular
  SPA
  Client-side routing
  Template-driven forms
  Plain CSS
  No component library
  Unit tests only

Backend:
  FastAPI
  uv
  SQLAlchemy ORM
  Synchronous SQLAlchemy
  FastAPI dependency injection
  No service layer
  No repository layer
  Multiple router files
  One models.py
  Ruff

Database:
  Database-agnostic SQLAlchemy design
  SQLite recommended for local development
  No Alembic
  Recreate DB after schema changes

Authentication:
  Signed HttpOnly SameSite browser-session cookie
  No JWT
  No login page
  No logout
  No password reset

Testing:
  Comprehensive TDD
  Backend unit + endpoint tests
  Mock database layer
  Frontend unit tests only

Infrastructure:
  Local only
  No Docker
  No CI
  No deployment
  No external worker
  No rate limiting
  No HTTPS requirement
```

---

**Status: FROZEN MVP SCOPE**
