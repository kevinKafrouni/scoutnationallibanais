# Scout National Libanais registry

The portal now uses a Node.js API and PostgreSQL. Members, access codes, resized photos, password hashes, sessions, and authentication rate limits are stored in the database. The browser receives only its signed-in member's record, or the registry when signed in as admin. A new database starts empty.

PostgreSQL suits this registry because it enforces unique Scout IDs and supports atomic registration: locking a registration code, creating a member, and redeeming the code happen in one transaction. The Node.js server serves the existing interface and its API on the same domain.

## Run locally

Install Node.js 22 or later and Docker Desktop (or use an existing PostgreSQL 17 server). The machine used for initial development had Node 18; upgrade before running the app in production.

```powershell
npm ci
Copy-Item .env.example .env
# Edit .env: set ADMIN_PASSWORD to a unique password of 12–128 characters.
docker compose up -d
npm start
```

Open **http://localhost:3000**. Opening `index.html` directly or using Live Server no longer works: authentication and storage require the API. Use the Admin tab with your configured password, generate access codes, and distribute one to each member.

The server applies the schema automatically at startup. `npm run migrate` also applies it explicitly. The initial `ADMIN_PASSWORD` creates the administrator only if none exists; subsequent migrations never reset the stored password. Change the password in the admin dashboard. Database credentials remain exclusively in the server environment.

## Deploy on Netlify with Supabase

The website is built into `dist/`; `/api/*` and `/healthz` are handled by Netlify Functions. `netlify.toml` defines the build, routes, security headers, and session cleanup schedule. Supabase remains the database. The live Supabase tables and admin account were initialized during setup.

1. In Netlify, choose **Add new project ? Import an existing project**, connect GitHub, and select `kevinKafrouni/scoutnationallibanais`, branch `master`. For an existing Netlify project, connect this repository in its build settings.
2. Netlify reads `netlify.toml`: build command **`npm run build`**, publish directory **`dist`**, functions directory **`netlify/functions`**, Node.js **22**. Do not use the repository root as the publish directory, and do not use a drag-and-drop static-only deploy.
3. Add these environment variables privately in Netlify's project settings, with **Functions** scope (or all scopes if your plan does not offer scope selection):

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase **Transaction pooler** URI, port **6543**, from your project's Connect dialog, with the database password percent-encoded |
   | `DATABASE_POOL_MAX` | `2` to limit connections per function instance |
   | `APP_ORIGIN` | Optional initially: leave unset to use Netlify's assigned site URL. Once the custom domain works, set `https://scoutnationallibanais.org` |
   | `AWS_LAMBDA_JS_RUNTIME` | `nodejs22.x` |

   Do not copy your local `APP_ORIGIN=http://localhost:3000` into the deployed site. The app uses its existing database admin account, so Netlify Functions do not need `ADMIN_PASSWORD`. Do not give untrusted deploy previews production database credentials. Environment-variable changes require a new deployment.
4. Deploy and open the assigned `https://...netlify.app` URL. Verify `/healthz`, sign in as admin, refresh, and sign out. The API runs automatically as a Function; it does not start `server/index.js` or run migrations per request.
5. In Netlify's domain management, add **scoutnationallibanais.org** and make it the primary domain. In GoDaddy DNS, use the exact apex and `www` DNS records shown by Netlify. Replace conflicting parking records only for these website hosts; preserve email records and unrelated subdomains. Enable/verify HTTPS in Netlify.
6. Set `APP_ORIGIN=https://scoutnationallibanais.org` in Netlify and redeploy. Use that domain for sign-in. Other origins are rejected for write requests; the `www` alias should redirect to the primary domain.

If publishing with the CLI, run `npx netlify login`, `npx netlify link` (choose your existing project), and `npx netlify deploy --build --prod` after setting the variables in Netlify. This publishes both assets and Functions.

See [Netlify Express deployment](https://docs.netlify.com/build/frameworks/framework-setup-guides/express/) and [Netlify function configuration](https://docs.netlify.com/build/functions/configuration/).

## Supabase connection and migrations

Your project is [ylgldiluovjaybgtyxlp](https://supabase.com/dashboard/project/ylgldiluovjaybgtyxlp). Netlify uses the transaction pooler because Functions scale on demand. Local development and the explicit migration command can continue using the session pooler on port 5432. This app uses unnamed queries compatible with transaction pooling.

Store local credentials in `.env`, which is excluded from Git. For a fresh database, set a unique `ADMIN_PASSWORD` of 12?128 characters and run `npm run migrate` locally with Node.js 22+. Keep migrations out of the Netlify build: deploy previews and asset builds must not modify the production schema. Subsequent migrations do not reset the admin password.

Database TLS is verified using Node's standard trust roots and the bundled public Supabase CA. `DATABASE_SSL_CA` can override the certificate bundle if Supabase rotates its CA. Never disable certificate verification to bypass a connection error.

The registry tables use RLS and deny Supabase `anon` and `authenticated` API roles access. The Node.js API performs authorization using database-backed sessions. This setup uses the privileged PostgreSQL connection only on the server, not Supabase Auth or browser Data API calls. Existing unrelated Supabase tables are not modified.

See [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Run the Netlify setup locally

Use Node.js 22 or later:

```powershell
npm ci
# Your existing .env supplies DATABASE_URL. Set this origin just for Netlify Dev:
$env:APP_ORIGIN='http://localhost:8888'
npm run dev:netlify
```

Open **http://localhost:8888**. The original `npm start` remains available at port 3000. Netlify Dev uses development cookies; deployed Functions always use Secure cookies. Only the four public website assets are copied into `dist`; `.env`, certificates, server source, and backups are never public assets.

## Backups and existing browser data

The original local-storage registry is not automatically uploaded, overwritten, or deleted. New registrations use PostgreSQL only. If the original browser contains real records, retain/export those before switching; legacy JSON needs a deliberate migration because it contains plaintext credentials and can conflict with new Scout IDs. No dummy records are seeded.

CSV and JSON buttons export member data and codes for administrative use. They exclude passwords and sessions and are **not restorable account backups**. The old browser JSON import has been removed: account recovery belongs to the database backup process, not a browser-wide state overwrite.

Use Supabase's database backups and periodically export a full database backup. Verify backup availability and retention for your selected Supabase plan in the dashboard, and rehearse a restore into a separate database before relying on it. Free-tier projects should maintain their own off-site dumps. Full dumps contain private member data and password hashes; keep them in restricted storage. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups).

## Checks and operational details

```powershell
npm run check
npm test
```

For the browser flow test, run `npx playwright install chromium` once, then `npm run test:browser`. On Windows with Edge already installed, set `$env:PLAYWRIGHT_CHANNEL='msedge'` instead of downloading Chromium. The browser test covers registration, reload, photo upload, sign-out/sign-in, and an administrator JSON export.

Integration tests run the schema and SQL against embedded PostgreSQL (PGlite). They cover role isolation, code redemption, validation, hashed credentials, session persistence across an HTTP server restart, logout, admin password rotation, rate limits, private file access, and QR generation. The embedded engine serializes connections: its competing-registration test is not a substitute for a concurrency test against a hosted PostgreSQL instance. Live DNS, HTTPS, and hosted PostgreSQL verification must happen after provisioning.

Sessions expire after 12 hours and use HttpOnly, SameSite cookies, with Secure cookies in production. Authentication is limited to 30 attempts per IP per 15 minutes; this includes registration, sign-in, and administrator password changes. A scheduled Netlify Function removes expired sessions and rate-limit rows every 15 minutes on published deployments; the local server uses a timer. The Netlify adapter uses Netlify's client-IP header for rate limiting and ignores user-supplied X-Forwarded-For. Local server proxy configuration still uses `TRUST_PROXY`.

QR codes are generated by this server and contain only the organization and Scout ID. They do not send names, dates of birth, or blood types to an external QR service, and they are not public identity-verification links.

Photos are resized by the browser and stored privately in PostgreSQL with a size cap. This is convenient for the current registry; a large photo collection should move to private object storage. The administrator view currently loads the full registry; add server-side pagination if the registry grows large. This release has one administrator account and no self-service forgotten-password flow.
