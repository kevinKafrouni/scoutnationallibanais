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

## Deploy scoutnationallibanais.org

Hosting is separate from the GoDaddy domain registration. `render.yaml` now defines only the Node.js web service on Render; PostgreSQL is hosted in your [Supabase project](https://supabase.com/dashboard/project/ylgldiluovjaybgtyxlp). The Render service is a **paid resource**; inspect its current estimate before creating it. The configuration connects to your existing Supabase project; deploying the web service and updating DNS are separate steps. Connecting Supabase to GitHub does not supply this Node.js server with database credentials or run `server/schema.sql`.

1. Push these project changes to `https://github.com/kevinKafrouni/scoutnationallibanais`.
2. Sign in to [Render](https://dashboard.render.com/), connect your GitHub account, and create a **Blueprint** from that repository. Render reads `render.yaml`.
3. Enter a unique `ADMIN_PASSWORD` (12–128 characters) when prompted. Keep it in your password manager. The database URL is wired automatically. Review the service/database plan estimate, then deploy.
4. In the web service's **Settings → Custom Domains**, confirm `scoutnationallibanais.org` is present. The Blueprint requests this domain; Render also adds the `www` redirect. Copy the exact DNS values displayed by Render.
5. In GoDaddy, open **Domain Portfolio → scoutnationallibanais.org → DNS** and update the web records:

   | Type | Name | Value |
   | --- | --- | --- |
   | A | `@` | The IPv4 address shown by Render (currently documented as `216.24.57.1`; use the dashboard value) |
   | CNAME | `www` | Your assigned Render service hostname, without `https://` |

   Replace conflicting parking/forwarding records for `@` and `www`, including conflicting AAAA records for these two hosts. Preserve mail/MX records, verification TXT records, and unrelated subdomains.
6. Click **Verify** in Render after DNS updates propagate. Render provisions HTTPS. Use **https://scoutnationallibanais.org** for sign-in. `APP_ORIGIN` is configured to that exact origin to protect write requests; signing in on the temporary `onrender.com` URL will be rejected unless you temporarily change `APP_ORIGIN` to match it.
7. Sign in as admin, generate a code, and register a real member. Verify the account from another browser, update a photo, and print the card. Check `/healthz` reports `{"status":"ok"}`.

See [Render deployment](https://render.com/docs/deploy-node-express-app), [Blueprint configuration](https://render.com/docs/blueprint-spec), [custom domains](https://render.com/docs/custom-domains), and [DNS instructions](https://render.com/docs/configure-other-dns).

## Connect your Supabase project

1. Open [project ylgldiluovjaybgtyxlp](https://supabase.com/dashboard/project/ylgldiluovjaybgtyxlp) and click **Connect**. Select **Session pooler**, using port **5432**. Copy the exact URI from the dashboard: the pooler hostname depends on the project's region and cannot be inferred from the project link.
2. Replace the password placeholder with your **database password**, URL-encoding special characters in the password. This is not your Supabase account password, publishable key, or service-role API key. If you do not know the database password, use the project's database settings to reset it and update any other clients that use it.
3. Store the complete URI privately as `DATABASE_URL` in Render's Environment settings (or the Blueprint prompt). For a local connection, copy `.env.example` to `.env` only if `.env` does not already exist, and set `DATABASE_URL` and `ADMIN_PASSWORD` there. `.env` is excluded from Git. Never put the real URI in `render.yaml`, browser code, or chat.
4. The app enforces verified TLS for Supabase connections, bundles the public Supabase CA certificate, and defaults to five database connections. If Supabase rotates its CA or the endpoint uses a different CA, set `DATABASE_SSL_CA` to the new PEM certificate in the server environment. Do not disable certificate verification to bypass a connection error.
5. Run `npm run migrate` locally with Node.js 22+, or let Render's pre-deploy command run it. This initializes the registry and admin account. Running only `schema.sql` manually does not initialize the admin password.
6. Confirm the tables appear in Supabase's Table Editor, then test the deployed app. Only after migration and a successful connection test is the live database connected.

The schema enables Row Level Security and revokes registry access from Supabase's `anon` and `authenticated` roles. This app uses its own server-side authentication; it does not use Supabase Auth or browser Data API queries. Use the `postgres` connection supplied by the dashboard for this setup: the table owner can access the registry while browser API roles cannot. Keep this privileged URI exclusively on the server. If this project is dedicated to this app, you can also disable the Supabase Data API in project settings because the app does not need it. Existing unrelated Supabase tables are not changed by the registry migration.

Supabase's GitHub migration workflow uses its own migrations directory; this repository currently runs migrations through the Node.js/Render command instead. The GitHub connection alone does not apply this schema.

See [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres) and [securing the Data API](https://supabase.com/docs/guides/api/securing-your-api).

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

Sessions expire after 12 hours and use HttpOnly, SameSite cookies, with Secure cookies in production. Authentication is limited to 30 attempts per IP per 15 minutes; this includes registration, sign-in, and administrator password changes. The server periodically removes expired sessions and rate-limit rows. Configure `TRUST_PROXY` only for your hosting proxy arrangement (the supplied Render configuration uses one proxy hop).

QR codes are generated by this server and contain only the organization and Scout ID. They do not send names, dates of birth, or blood types to an external QR service, and they are not public identity-verification links.

Photos are resized by the browser and stored privately in PostgreSQL with a size cap. This is convenient for the current registry; a large photo collection should move to private object storage. The administrator view currently loads the full registry; add server-side pagination if the registry grows large. This release has one administrator account and no self-service forgotten-password flow.
