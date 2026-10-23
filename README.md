# SideDesk

Self-hosted, single-owner freelance IT management. This repository implements the Milestone 0 foundation and a Milestone 1 candidate: clients/contacts/contextual notes, quick activities, manual time, persistent timer, and a browser-encrypted credential vault with recovery, custom fields and TOTP.

**Do not enter actual client credentials until an independent security/cryptographic review is complete.** Tests do not constitute an audit. Ordinary HTTP use is supported; vault features fail closed when secure browser APIs are unavailable. A VPN does not replace TLS or protect against malicious JavaScript from a compromised host.

## Docker quick start

Requires Docker Engine and Compose v2. Use a fresh deployment directory and a supported modern browser.

```sh
cp .env.example .env
openssl rand -hex 32  # use a unique value for POSTGRES_PASSWORD
openssl rand -hex 32  # use a different value for SESSION_SECRET
openssl rand -hex 32  # use a different value for SETUP_TOKEN
```

Edit `.env`. Replace all example secrets, including the password inside `DATABASE_URL` (URL-encode special characters). Set `APP_URL` to the exact origin you will open, including scheme and port. The default binding is loopback. LAN access requires `APP_BIND=0.0.0.0` and a matching `APP_URL`, for example `http://192.168.1.50:3000`. Restrict access with firewall/VPN. The database has no host port mapping.

```sh
docker compose up --build -d
# Open the configured APP_URL.
docker compose ps
docker compose logs --tail=50 app migrate
```

The migration service waits for PostgreSQL, applies checksummed non-destructive SQL migrations, then starts the app. Setup needs the one-use `SETUP_TOKEN`; create a login password of 14–256 characters. After ownership creation, public setup closes. Business identity, timezone (default America/Edmonton), CAD, and hourly rate are configured at setup. Configure remaining defaults and run storage/backup checks in Settings. Vault setup can be postponed indefinitely. SMTP is deferred to Milestone 3.

No default owner credentials, vault keys, real client data, or production secrets are seeded. Remove `SETUP_TOKEN` from configuration after setup if desired. Keep `SESSION_SECRET`, database password and persistent volumes across updates. Session cookies use HttpOnly, SameSite=Strict, 30-minute idle/12-hour absolute expiry, and Secure when the configured origin is HTTPS. HTTP cannot provide transport confidentiality for account login or business data.

## HTTPS (optional)

Caddy/Nginx/Traefik may terminate TLS and proxy to the loopback-bound app. Set `APP_URL=https://your-private-host.example` and ensure the proxy preserves its Host and Origin headers. The application does not trust forwarded headers to infer transport security; the operator declares the external origin. A private certificate must be trusted by the browser. HTTPS remains optional for ordinary functionality; localhost may have secure-context capabilities without HTTPS. Capability checks, not scheme guessing, govern the vault. No encryption fallback exists.

## Development and checks

Use Node 24 LTS and npm. A reachable PostgreSQL instance is required for the app; development uses the same migrations as production. Set environment variables in your shell for CLI scripts; Next.js itself reads `.env`.

```sh
npm ci
npm run db:migrate
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` starts disposable real PostgreSQL on loopback port 55433, runs integration and cryptographic tests, and stops it. `npm run test:e2e` starts its own PostgreSQL on 55432 and production app instances on 3100/3101. It uses a test-only local DNS mapping for `sidedesk.test` to prove insecure-origin restrictions. These test scripts contain fictional credentials only; never expose test ports publicly. Each acceptance run uses a fresh disposable cluster under `work/`; stop any interrupted test server before rerunning. Test artifacts go to `test-results/` and `playwright-report/`, both ignored by Git.

For optional fictional demo records **after** owner creation on a demo deployment only:

```sh
docker compose exec -e ALLOW_FICTIONAL_SEED=yes app npm run db:seed
```

This refuses nonempty client lists. Demo seeding never creates a default owner or vault.

## Vault use and limits

Create a separate vault password in Credentials. Save the randomly generated recovery key offline and confirm it before envelopes are stored. Secrets are encrypted in the browser using AES-256-GCM; a random master key is wrapped by separately derived password/recovery keys. Argon2id parameters and cryptographic formats are versioned. Username, password, service URL, notes, recovery codes, custom fields and TOTP seeds are encrypted. Client associations and credential titles are plaintext discovery metadata.

The vault locks on fresh login, manual lock, inactivity, hidden tab, navigation away from Credentials, logout or detected session expiry. Keys and plaintext are never intentionally persisted in browser storage or server state. JavaScript memory zeroization is best effort. Multiple tabs receive lock signals, never keys. Password changes rewrap the same master key. Recovery replaces password and recovery envelopes without rewriting credentials. Test the recovery key using the rehearsal control. Losing both unlock password and recovery key is unrecoverable.

Credential editing supports custom fields; even fields set to display unmasked are encrypted. TOTP supports SHA1/SHA256/SHA512, six/eight digits, and periods 15–120 seconds; HOTP is explicitly rejected. Manual Base32, pasted URI, local QR upload and camera scanning are supported subject to browser permissions. QR content never leaves the browser. The device clock governs TOTP. Storing password and TOTP in one vault reduces factor independence.

Reveal/copy audit events contain no values and are best effort, not tamperproof. Clipboard success is only shown after `writeText` succeeds. The clipboard may retain data after lock; no clearing guarantee is made. Client-side encryption protects stolen database/backups from immediate plaintext disclosure; it cannot defeat malicious same-origin JavaScript, compromised extensions/endpoints, or host rollback of an entire backup. Master-key rotation has an architecture design but no M1 user-facing implementation; do not claim changing the password revokes old stolen backups.

## Backup and restore

Run **Create backup** in Settings or:

```sh
docker compose exec app npm run backup
```

The server uses PostgreSQL `pg_dump`, copies the private upload tree and writes a SHA-256 manifest in `BACKUP_DIR`. Domain mutations pause under a shared/exclusive database advisory-lock protocol while capture runs. No arbitrary command/path is accepted from the browser. Backups include ciphertext/key envelopes; they do not include deployment secrets. A failure removes the incomplete directory and is reported as failure. A backup on the same disk is not an off-host copy; retention/scheduling are not yet implemented.

For a restore into a **fresh deployment**, install the same application version and configure the original deployment secrets separately. Verify every manifest file checksum before restore. Restore database.dump with matching PostgreSQL tools into an empty database, copy the backed-up uploads into the new private upload volume, then start the app and apply migrations. Revoke restored sessions. Log in and rehearse vault recovery against a real restored credential. See [docs/restore.md](docs/restore.md) for concrete commands. Do not test disaster recovery by overwriting a live deployment.

## Updates, rollback and account recovery

Back up before updating; pull the intended source commit, build, and use `docker compose up --build -d`. Migrations have checksums and an advisory lock. Never use schema resets or edit applied migrations. Roll application code back only if schema compatibility is documented; otherwise restore into a fresh deployment from a compatible backup. Do not delete volumes during ordinary upgrades.

If the owner login password is lost, a deployment operator may supply a new password through stdin to `npm run db:reset-owner` inside the app container. Do not place passwords in command arguments/history. This revokes all account sessions and never changes vault envelopes. Vault recovery still needs the separate recovery key/password. There is no public account-reset endpoint.

## Milestones

- M0: owner setup/auth, responsive themes/shell, PostgreSQL, Docker, CI, security architecture and baseline backup.
- M1: encrypted vault/recovery/TOTP, clients/contacts/notes, quick work and timer.
- Next, M2: structured jobs, unbilled queue, rate hierarchy/rounding, invoice allocations and unique numbering, immutable PDFs and payments.

Sales, Inventory, Expenses and Reports are labelled future features rather than dead navigation. No later-milestone feature is represented as implemented. Read [the full specification](docs/SIDEDESK_SPEC.md), [security design](docs/threat-model.md), [ADRs](docs/implementation-decisions.md), and [milestone checklist](docs/milestone-1-checklist.md).
