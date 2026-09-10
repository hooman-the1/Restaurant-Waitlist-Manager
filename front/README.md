# Mock-backed local demo

From `front/`, run:

```text
npm start
```

No backend is required. Open the base URL at `http://localhost:4200/` and use these demo paths:

- `/restaurants/demo-restaurant` — the `Demo Restaurant` public page with the name, phone number, and party-size join form.
- `/status/8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44` — the active `Demo Restaurant` status at position `#1`, with cancellation available.
- `/status/c2a7198e-6d40-4b53-9f81-37e5a6c04bd2` — the resolved `Demo Restaurant` status, shown as `Seated` without a queue position or cancellation.
- `/dashboard` — the verified `Demo Restaurant` dashboard, with Morgan Lee at `#1` and Sam Rivera at `#2` under Active, and Alex Chen shown as `Seated` under Resolved Today.

Joins and status actions are kept only in memory. Restarting the development server or reloading the browser application creates the documented fresh seed state again.
