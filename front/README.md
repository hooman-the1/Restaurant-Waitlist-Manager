# Frontend local development

Run the backend first. From `backend/`:

```powershell
npm ci
Copy-Item .env.example .env
```

Replace the placeholder `SECRET_KEY` in `.env` with a strong local value, retain the default `PORT=8000` and `FRONTEND_ORIGIN=http://localhost:4200`, then run:

```powershell
npm start
```

In a second terminal, start Angular. From `front/`:

```text
npm ci
npm start
```

Open `http://localhost:4200/`. The production Angular composition calls the backend at exactly `http://localhost:8000` and sends credentials through the browser.

Useful seeded Angular URLs are:

- `http://localhost:4200/restaurants/demo-restaurant`
- `http://localhost:4200/status/8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44`
- `http://localhost:4200/status/7a2bfe87-27d4-4e13-8b0d-e7804c1e7421`
- `http://localhost:4200/status/c2a7198e-6d40-4b53-9f81-37e5a6c04bd2`

To create an account, open `http://localhost:4200/signup`. The backend prints the one-time verification URL locally; open its token using the Angular `http://localhost:4200/verify/{token}` route. Successful verification stores the signed `restaurant_session` cookie in the browser for dashboard access.

The seeded dashboard at `http://localhost:4200/dashboard` also requires a locally signed cookie. Follow the safe session instructions in [`backend/README.md`](../backend/README.md); never commit or paste a cookie, signing secret, demo password, or bearer token into the repository.

The backend keeps runtime data in process memory. Reloading an Angular page preserves the current backend state and browser cookie. Runtime state resets only when the backend process restarts.
