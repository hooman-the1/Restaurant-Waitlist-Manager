# Frontend Backlog

These tasks implement only the frozen MVP in `doc/plan.md`. Each task must include focused Angular unit tests and must not introduce a UI library, client-side validation, state-management library, end-to-end tests, or a direct HTTP call from a component, guard, or template.

## 1. Initialize the empty Angular frontend
Goal: Create an Angular application in `front/` that starts successfully and has one passing unit test.
Description: Create the `front/` Angular SPA using the current Angular defaults, with routing enabled and plain CSS. Keep the initial application intentionally empty apart from the generated shell; prove the configured unit-test runner can execute one passing test. Do not add product screens, API calls, or dependencies.

## 2. Create the application shell and global routes
Goal: Provide the shared responsive layout and every MVP route with safe placeholder content.
Description: Add a shared header and a static footer containing only the app name, then configure routes for signup, verification callback, restaurant dashboard, public restaurant join, customer status, and a generic not-found message. Use semantic HTML and simple responsive CSS, without a landing page or a custom styled 404 experience. Add unit tests for route configuration and the shared layout.

## 3. Define frontend API contracts and domain view models
Goal: Establish typed, backend-independent data contracts for all frontend use cases.
Description: Define TypeScript interfaces/types for signup, verification, dashboard queue data, public restaurant data, joining a queue, private customer status, cancellation, and staff resolution. Include explicit error/result shapes needed to display backend validation, unauthorized, not-found, and unexpected errors without leaking backend transport details. Add unit tests that compile and exercise representative contract/result mappings where runtime helpers are introduced.

## 4. Create the centralized frontend service boundary
Goal: Make a single application-owned service layer the only route through which UI code can access backend behavior.
Description: Define focused domain-facing service interfaces (for example, restaurant account, restaurant dashboard, and customer waitlist operations) and provide Angular injection tokens or an equivalent composition mechanism. Components and route guards must depend only on these interfaces, never `HttpClient`, URLs, cookies, or backend DTO details. Add unit tests proving consumers can receive a substitute implementation through Angular dependency injection.

## 5. Implement mock restaurant-account services
Goal: Support signup, email verification, and dashboard-session checks without a backend.
Description: Implement the restaurant-account service interface with asynchronous in-memory behavior for unique-name/email validation, signup, verification-token consumption, and current dashboard access. Seed only the minimal verified-account/session state needed by the mock app and return application-owned validation, unauthorized, and unexpected-error results. Register this implementation through the centralized service boundary and add unit tests for its stated behaviors.

## 6. Implement mock public waitlist join services
Goal: Support public restaurant lookup and customer joining without a backend.
Description: Implement the public-facing portion of the customer waitlist service against in-memory data, including restaurant lookup by slug and queue joining. Enforce party-size limits and normalized-phone duplicate protection while returning a new private status token after success; preserve no customer data outside the mock service. Add unit tests for found/missing restaurants, successful joining, each party-size error, and duplicate-phone rejection.

## 7. Implement mock private customer-status services
Goal: Support private status lookup, FIFO position calculation, and customer cancellation without a backend.
Description: Implement the private-token portion of the customer waitlist service against the shared in-memory waitlist state, returning active position, resolved status, or missing-token results. Allow immediate cancellation of active entries, recalculate remaining FIFO positions, and preserve the ability for a cancelled phone number to join again through the public service. Add unit tests for active, resolved, missing, cancellation, position recalculation, and rejoin behavior.

## 8. Implement mock restaurant dashboard services
Goal: Support dashboard queue loading and staff status changes without a backend.
Description: Implement the dashboard service interface with seeded active and same-day resolved entries for a verified mock restaurant. Return the precise fields the dashboard may display, apply seated/cancelled/no-show choices immediately, and move resolved entries out of the active queue while recalculating positions. Add unit tests for dashboard access, FIFO ordering, empty sections, and each status transition.

## 9. Build the restaurant signup page
Goal: Let a restaurant submit its name, email, and password to begin account creation.
Description: Implement a template-driven signup form with labels, one form-level backend-error area, preserved restaurant name/email after validation errors, and a cleared password after a failed submission. Disable the submit control and show a simple loading state while the request is pending; do not add client-side validation or show the public URL. Add component tests for submission, loading, backend-error handling, and navigation to the verification step/result specified by the service contract.

## 10. Build the email-verification callback page
Goal: Verify a restaurant from its single-use link and direct successful users to the dashboard.
Description: Read the verification token from the callback route, invoke the restaurant-account service once, and show a simple loading, success-transition, or generic/error state as appropriate. On success navigate directly to the dashboard; do not create login, resend-verification, or account-recovery UI. Add component tests for token handling, successful dashboard navigation, invalid/used-link handling, and unexpected failures.

## 11. Add restaurant dashboard access protection
Goal: Prevent unauthenticated browser navigation to the restaurant dashboard.
Description: Implement an Angular route guard that asks the centralized restaurant-account service whether the current browser session may access the dashboard. Redirect denied access to an appropriate existing generic route/message while treating the guard as UX only—the future backend remains authoritative. Add unit tests for allowed, denied, and service-failure outcomes.

## 12. Build the restaurant dashboard queue views
Goal: Display the restaurant’s active FIFO queue and same-day resolved entries.
Description: Implement the protected dashboard using the dashboard service, showing the restaurant name, an Active section, and a Resolved Today section. Active rows show position, customer name, full phone number, and party size; resolved rows show name, party size, and plain-text final status, with the specified empty-state messages. Provide a manual refresh control and loading/error states, but no auto-refresh, counts, public URL, email, filtering, sorting, search, pagination, notes, or table controls. Add unit tests for populated and empty sections, data visibility rules, and manual refresh.

## 13. Add immediate staff resolution controls to the dashboard
Goal: Allow staff to mark active customers seated, cancelled, or no-show from one immediate-action menu.
Description: Add one dropdown/menu per active row with Seated, Cancelled, and No-show options; applying a selection must immediately call the dashboard service and refresh/update displayed data. Do not add confirmation dialogs, Apply buttons, success toasts, undo, hard delete, or editing controls. Add unit tests for each selection, pending/error behavior, and removal from Active plus appearance in Resolved Today after success.

## 14. Build the public restaurant waitlist join page
Goal: Let a customer join the waitlist identified by a public restaurant slug.
Description: Load and display the restaurant name as the page title, then provide a template-driven form for name, phone, and party size. Submit through the customer waitlist service, preserve all entered values on backend validation errors, show the duplicate-phone message supplied by the service, and disable the button with `Joining…` while pending; do not add client-side validation, queue size, wait time, CAPTCHA, notes, or customer accounts. On success navigate directly to the private status URL. Add unit tests for initial lookup, successful submission/navigation, value preservation, duplicate-phone error, generic error, and loading state.

## 15. Build the private customer status and cancellation page
Goal: Show a customer’s private queue state and let them cancel an active entry.
Description: Resolve the unguessable status token from the route and display only the restaurant name plus either the numeric queue position while active or the plain-text resolved status. Provide immediate cancellation for active entries with no confirmation dialog; do not show name, phone, party size, join time, estimated wait, or a special “you’re next” message. Handle an unavailable/deleted token as the generic not-found route/message. Add unit tests for active, resolved, missing, cancellation-success, cancellation-error, and data-privacy rendering cases.

## 16. Add active-status polling lifecycle behavior
Goal: Refresh an active customer’s status every 30 seconds and stop once it is resolved.
Description: Extend the private status page so polling begins only after an active status is loaded, uses the centralized customer waitlist service, and stops when the entry becomes seated, cancelled, or no-show or when the component is destroyed. Do not add a manual refresh control. Add time-controlled unit tests for the 30-second cadence, transition from active to resolved, no polling after resolution, cleanup on destruction, and request-failure behavior.

## 17. Verify the mock-backed frontend as an integrated local demo
Goal: Confirm the complete frontend can be started and exercised with no backend running.
Description: Configure the development composition point to use the existing mock services and confirm the demo data makes each implemented route reachable, including a public restaurant, active customer status token, resolved customer status token, and verified restaurant dashboard session. Run the complete Angular unit-test suite and the production build; fix only integration/configuration issues discovered by those checks. Add a concise developer note inside `front/` describing how to start the mock-backed app and the available demo paths, without creating a repository README.
