# SideDesk

Self-hosted, single-owner freelance IT management. [Milestone 3 acceptance checklist](docs/milestone-3-checklist.md). Implemented through Milestone 3: clients, contacts, contextual notes, quick activities, persistent time tracking, encrypted credentials, structured jobs, private job files, unbilled work, invoice drafts, immutable issued PDFs and payments, quote conversion, configurable tax profiles, SMTP history, expenses/receipts, travel charges and audited credits/refunds.

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

The migration service waits for PostgreSQL, applies checksummed non-destructive SQL migrations, then starts the app. Setup needs the one-use `SETUP_TOKEN`; create a login password of 14–256 characters. After ownership creation, public setup closes. Business identity, timezone (default America/Edmonton), CAD, and hourly rate are configured at setup. Configure remaining defaults and run storage/backup checks in Settings. Vault setup can be postponed indefinitely. SMTP is optional; configure it in Settings when needed.

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
npx playwright install chromium
npm test
npm run build
npm run test:e2e
```

`npm test` starts disposable real PostgreSQL on loopback ports 55433–55436, runs integration, PDF and cryptographic tests, and stops it. `npm run test:e2e` starts its own PostgreSQL on 55432 and production app instances on 3100/3101 and a disposable TLS SMTP fixture on 3110. The fixture generates its own local test certificate and never contacts real recipients. It uses a test-only local DNS mapping for `sidedesk.test` to prove insecure-origin restrictions. These test scripts contain fictional credentials only; never expose test ports publicly. Each acceptance run uses a fresh disposable cluster under `work/`; stop any interrupted test server before rerunning. Test artifacts go to `test-results/` and `playwright-report/`, both ignored by Git.

For optional fictional demo records **after** owner creation on a demo deployment only:

```sh
docker compose exec -e ALLOW_FICTIONAL_SEED=yes app npm run db:seed
```

This refuses nonempty client lists and requires owner setup. It creates fictional client/job/activity/time records, quote/invoice drafts, an expense recovery and a manual trip. Demo seeding never creates a default owner or vault.

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

## Jobs and invoicing

Create a job from Work with scope, priority, status, due date and optional hourly rate. Activities still work directly against a client. Link existing activities to a same-client job; earlier time keeps its historical rate and job snapshots. Add contextual job notes and private files up to 10 MB. Downloads require owner login and are served as attachments, never executable previews. These ordinary files are not encrypted vault records; do not upload credential secrets.

Rates resolve entry override → job → client → business. Time captures the rate, rounding increment and entry/group scope when recorded or when a timer starts. Review unallocated entries with an explicit correction reason. Changing settings does not silently reprice history. Invoice conversion rounds up by the captured increment, once per entry or once per compatible group. Compatible groups share historical job, rate, increment and scope. All amounts use integer cents and rational half-up arithmetic; time prints exact billable minutes.

In Sales → Unbilled select stopped entries for one client and create a draft. A draft reserves each entire source entry. Partial time allocation is deliberately unavailable; removing a line, discarding a draft or voiding an unpaid invoice releases reservations. Allocated time is protected from edits. A client with unfinished billing cannot be archived.

Drafts support contact selection, manual lines, ordering, discounts and optional per-line taxes after enabling taxes in Settings. Configure business identity, terms, payment instructions, rounding scope and accent in Settings. Save to calculate exact server totals, preview Letter/A4, then issue. Number allocation, snapshots and PDF bytes commit together; render failure leaves the draft and sequence unchanged. Issued lines, identity, amounts and original PDF are immutable even after client/settings changes. Download always returns the exact issued bytes. The PDF shows received/balance **at issue**; current payments and balance appear on the invoice page.

Record partial/full receipts with date, method and reference. Correct a mistaken receipt with an append-only full reversal and reason. This corrects bookkeeping; it does not initiate a bank refund. Overpayments are rejected. Voiding requires zero net receipts and a reason. Original PDFs remain unchanged; void state appears in the app history. Credits/refunds, quotes, SMTP, configurable taxes and expenses/travel are available as described below.

Chromium is bundled with the Docker image; no external PDF service, CDN or runtime browser download is needed. Local development must run `npx playwright install chromium` before PDFs/tests. Optional `PDF_CHROMIUM_PATH` selects an installed compatible Chromium executable. Rendering disables JavaScript/network access, uses escaped server HTML and bounds concurrency/time. Issued PDF bytes live transactionally in PostgreSQL; job files live in the private upload volume. Backups include both, with an application-version manifest. M2 adds migration `0002`; M3 adds `0003`. Code downgrades against newer schemas are unsupported. Restore a compatible pre-upgrade backup into a fresh deployment for rollback.

## Quotes, taxes and SMTP

Sales → Quotes supports editable drafts with contacts, quantities, rates, discounts, notes and terms. Save and preview, then publish to assign a quote number and freeze the exact PDF and parties/prices/taxes. Publishing is separate from sending. Record explicit acceptance or decline with evidence; do not infer client acceptance from an email result. Expiry uses the business timezone. Revise an expired or changed quote into a new draft, retaining its predecessor and original document.

An accepted quote can create a linked job and invoice. Conversion copies agreed prices and tax snapshots despite later rate/client/settings changes. Quote-derived invoices show their accepted reference and flag saved scope/price/tax differences before issue. There is one active invoice per quote; discarded drafts or void invoices retain history and permit a replacement. Conversion does not automatically reserve actual time or future stock. Review actual unbilled work explicitly to avoid charging both fixed scope and time for the same work.

Settings → Tax profiles configures up to four named components, with three decimal places in percentage rates and optional compounding on earlier components. No registration or regional rate is assumed. Enable taxes to apply nonzero rates. Apply a profile to individual lines or explicitly to all draft lines, with zero-rated/exempt overrides. Components round half-up to cents per line, then sum. Saved component snapshots remain fixed until explicitly changed; editing a profile does not reprice existing documents. M2 manual rates remain supported. Disabling tax does not rewrite stored documents; re-enable taxes before saving edits to a taxed draft, or explicitly choose zero/exempt treatment.

For authenticated SMTP, generate a **separate** random deployment key with `openssl rand -hex 32`, save it as `SMTP_ENCRYPTION_KEY` in `.env`, and recreate the app container. Keep this key outside backups alongside deployment secrets. It protects a versioned AES-256-GCM server-side password envelope, independent of the browser credential vault. Missing/wrong keys fail closed. To rotate it, preserve the old key until ready, configure a new dedicated key, then explicitly replace the saved SMTP password. Losing this deployment key does not change vault recovery; the SMTP password must be entered again.

Configure host/port, verified implicit TLS or required STARTTLS, username/password and sender in Settings. A blank password retains the encrypted value. **Test saved SMTP connection** verifies connection/authentication and sends no email. Optional `SMTP_CA_FILE` identifies an operator-managed trusted private CA file inside the container; mount it read-only through a Compose override and preserve it separately. Certificate verification cannot be disabled. Plain mode is an explicit trusted local-relay option with no authentication; it cannot transmit a username/password. Opening SideDesk over ordinary HTTP still lacks browser-to-server transport confidentiality; use the existing HTTPS recommendation when handling sensitive settings.

Email PDF opens a recipient/message confirmation form and attaches the exact published document. History distinguishes pending, failed, unknown and SMTP-accepted outcomes. Only confirmed server acceptance produces a sent status; inbox delivery is never claimed. Network ambiguity or a crash can leave an uncertain/pending attempt. Stable request keys prevent automatic duplicate submission. Check the mail server/history before explicitly starting another attempt. Backups restored with pending attempts **never auto-send**. No real emails are sent by automated tests.

## Expenses, travel, credits and refunds

Expenses records vendor, date, tax-inclusive CAD cost, included tax, category, payment method, optional client/job, contextual Markdown notes and private receipt files. Customer recovery is a separate before-invoice-tax amount; it is never copied from cost without an explicit choice. Business-only expenses create no invoice charge. Edits require a reason and retain append-only correction history. Allocated costs are locked. Archiving retains history/files and removes unallocated charges from the queue.

Trips records manual distance to 0.001 km, optional origin/destination, purpose, duration, client/job, a chosen mileage rate and an independent travel labour rate/rounding increment. Mileage and labour are separate optional customer charges. No CRA rate or deductible mileage is assumed. These records do not create a second vendor expense. Linked jobs expose associated costs and trips.

Unbilled charges in Expenses (also linked from Sales) groups recoveries and travel charges by client. Select full charges to create a draft, or add them to an existing invoice. Full-source allocations prevent duplicate billing and protect source facts. Discarding a draft or voiding its unpaid invoice releases them. Ordinary credits do not silently unbill source work. Receipt files use the same private owner-only 10 MB attachment policy as job files, not vault encryption.

Invoice credits and refunds are append-only adjustments with reasons/dates/references and explicit reversals. A credit reduces the customer obligation and records any tax included in that credit; remaining total, pretax value and tax component are bounded independently. A refund records money already returned outside SideDesk and cannot exceed refundable customer credit or net receipts. Cash refunds do not apply a second tax credit. The app never initiates a bank transfer. Reversals preserve originals; reverse relevant refunds before reversing a receipt that would otherwise make net cash negative.

Outstanding = max(issued total − credits − net cash, 0). Refundable customer credit = max(net cash − issued total + credits, 0). Net cash = receipts − receipt reversals − refunds + refund reversals. Original totals/PDFs never change. “Settled” distinguishes credit-adjusted completion; “refund due” highlights customer credit still owed. Dashboard net cash includes refunds and corrections, separately from costs and outstanding invoices. These are business records, not double-entry accounting or tax filings. Standalone credit-note PDFs, bank integration, foreign-currency conversion and comprehensive reports are not implemented.

## Milestones

- M0: owner setup/auth, responsive themes/shell, PostgreSQL, Docker, CI, security architecture and backup.
- M1: encrypted vault/recovery/TOTP, clients/contacts/notes, quick work and timer.
- M2: jobs, private files, unbilled time, rate/rounding snapshots, invoice allocations/numbering, immutable PDFs and receipts.
- M3: quotes/conversion, configurable tax components, SMTP history, expenses/receipts, mileage/travel charges and audited credits/refunds.
- Next, M4: products, quantity lots and serialized stock, stock movements, repair/acquisition cost basis, serialized sales and client assets.

Inventory and Reports remain labelled future features. Read [the full specification](docs/SIDEDESK_SPEC.md), [security design](docs/threat-model.md), [implementation decisions](docs/implementation-decisions.md), [M3 design](docs/milestone-3-design.md), and [M3 checklist](docs/milestone-3-checklist.md). Earlier checklists retain their historical evidence. M4 requires a new confirmation.
