# SideDesk — Product Design & Codex Implementation Specification

**Version:** 1.0 · **Status:** Approved product direction / implementation blueprint · **Date:** 23 October 2026

> **Product directive:** Build a clean, responsive, self-hosted **single-user freelance IT business manager**, not an enterprise MSP or general ledger accounting product. Prioritize fast everyday use, accurate records, and secure handling of client credentials. Implement incrementally, with working, tested deliverables at each milestone.

## 1. Product vision and decisions

SideDesk unifies client information, small work activities, full jobs, time tracking, notes, quotes, invoices, payments, inventory, resale equipment, client-owned assets, expenses, mileage and travel time, reports, and an encrypted client credential vault. It is for freelance work **separate from the user's full-time employment**. Client logins or multi-user collaboration are **out of scope**.

### Binding decisions

- **Work:** Hybrid. Log a quick activity directly to a client, or create structured jobs for larger work. Activities may later be assigned to jobs.
- **Users:** One authenticated owner; no client portal, staff permissions, payroll or employee scheduling.
- **Billing:** Full quote/invoice PDFs, optional SMTP email, flexible client/job/time-entry rates, configurable rounding and Canadian sales taxes, partial payments, credits/refunds, immutable issued-document snapshots.
- **Inventory:** Both quantity-based products and serialized units. Track acquisition, refurbishing, cost, resale and the transfer of sold units to client asset records.
- **Client assets:** Track client-owned equipment and its service history, distinct from business-owned sale stock.
- **Expenses:** Full expenses, receipts, business versus client costs, mileage and travel time; practical reporting, **not double-entry accounting**.
- **Notes:** Rich integrated notes on clients/jobs/assets/activities/expenses, not a separate notebook.
- **Themes:** Fully designed light and dark themes; follow system preference with manual override.
- **Network:** Primarily private LAN/VPN. Neither HTTPS nor reverse proxy is a mandatory deployment prerequisite. Display a strong HTTPS recommendation at onboarding and in Settings; HTTP is allowed with browser capability warnings and secure-feature restrictions.
- **Vault:** Built into the initial architecture; separate password to unlock; encrypt secrets on the client before upload; hidden passwords by default; reveal/copy buttons; custom fields and TOTP.
- **Delivery:** One master spec, implementation in tested milestones.

### Non-goals

No multi-tenant SaaS, integration with the user's full-time employer, automatic bank reconciliation, tax filing, enterprise ticket SLAs, remote access tool, real-time collaboration, CRM marketing automation, card payments, or plaintext credential storage.

## 2. Principles and UX acceptance bar

1. **Quick first:** Add a client, activity, payment or expense in the minimum reasonable number of interactions. Quick activity creation must not demand job creation.
2. **Records connect:** Client → jobs/activities/assets/credentials → time/notes/items → quote/invoice/payment, with traceable links.
3. **No accidental financial edits:** Drafts editable; issued documents, historical cost/rates/taxes and payment events have preserved snapshots; corrections via void/revision/credit as appropriate.
4. **Transparent money:** Clearly separate revenue, invoices, actual cash received, stock acquisition spend, cost of goods sold, inventory value, and estimated profit; label reports with basis and caveats.
5. **Keep sensitive data narrow:** Normal client/job endpoints must not return decrypted vault secrets; no secrets in logs, exports, analytics, emails, error reports or search indexes.
6. **Predictability over cleverness:** Human-readable labels, explicit save/confirmation states, reversible soft deletes where safe, informative empty/error states.
7. **Accessible:** Keyboard operable, visible focus, sufficient colour contrast, icon buttons with labels, status not conveyed by colour alone.

## 3. Navigation, information architecture and page contracts

**Primary desktop sidebar:** Dashboard; Clients; Work; Sales (Quotes, Invoices, Payments); Inventory; Expenses; Credentials; Reports; Settings. Collapse to icon rail. **Top bar:** breadcrumb, global search (Cmd/Ctrl+K), persistent active timer, `+ New` menu, theme switch, owner menu, Lock Vault. On small screens use compact nav/drawer and prominently accessible Quick Activity/Timer actions.

| Page | Primary content | Main action | Essential states |
|---|---|---|---|
| Dashboard | Revenue received this month, open balance, unbilled work, active jobs, follow-ups, recent timeline | Quick activity / start timer | Empty business, partial setup |
| Clients | Searchable individuals/businesses table, status, balance, recent work | New client | No clients, archived |
| Client detail | Overview, contacts, activity feed; tabs for Work, Invoices, Quotes, Assets, Credentials, Files/Notes, Purchases | New activity/job | Restricted secret metadata |
| Work | Activities/jobs list, statuses, filters, time entries, project detail | New activity/job | Unbilled, billed, cancelled |
| Sales | Quotes/invoices tables, aging, outstanding payments | New quote/invoice | Draft, issued, overdue, void, paid |
| Inventory | Product catalog, quantity/serialized views, purchase links, reserved/sold items | Add item / stock | Out of stock, reserved, sold |
| Expenses | Expense list, categories, receipts, mileage/trips | New expense/trip | Unreconciled/imported (future) |
| Credentials | Client-scoped credential list with labels only while locked, encrypted details when unlocked | New credential / unlock | Locked, unsupported secure context, recovery required |
| Reports | Date-filtered financial/activity summary, exported CSV | Export | Clearly labelled illustrative/partial data |
| Settings | Profile, invoice business identity, taxes, billing, SMTP, backup, security, HTTPS warning | Save/test settings | Validation and diagnostic messages |

### Visual system — mandatory UI guidelines

- **Style:** Crisp restrained SaaS workspace: compact, efficient, modern. Avoid giant tiles, gratuitous illustration, gradients, decorative animations and modal-overuse.
- **Layout:** Sidebar ~232–256px expanded, ~64px collapsed; main max content ~1440px; 24–32px desktop gutters; responsive 16px mobile gutters. Dense but legible tables with sticky headers when appropriate.
- **Typography:** Inter or system UI fonts; body 14–15px, headings 20–28px, small metadata 12–13px; tabular numbers for currency, dates/time and quantities.
- **Colours:** Neutral light/dark surfaces, muted blue primary accent; consistent semantic success/warning/danger/info colours. Do not rely on colour alone for status. Provide tokenized CSS variables rather than hard-coded page colours.
- **Controls:** Consistent 8–10px radii, subtle borders, 40–44px touch targets on mobile, compact desktop actions, icons accompanied by tooltips/accessible names. Confirmation for destructive actions, inline validation, nonblocking toast for success.
- **Tables:** Sort, filter, search, pagination or virtualization as needed; column visibility optional later. Row click opens detail; trailing contextual actions; distinguish monetary totals from values not yet collected.
- **Forms:** Use drawers for short add/edit flows; dedicated pages for invoices, quotes, jobs, inventory units and settings. Save drafts, provide meaningful defaults and no compulsory irrelevant fields.
- **Navigation:** Remember current filter/tab where reasonable; URL-addressable record details; keyboard shortcuts; global search over safe metadata only.
- **Responsive:** Essential tasks fully work on phone; wide financial/inventory tables may use responsive card rows or horizontal scroll with sticky identifiers.
- **Theme:** No incomplete dark-mode screens; verify charts, PDFs preview, modals, code/credential fields, error and loading states in both themes. PDFs remain print-oriented regardless of app theme.

### Critical UI components

1. `QuickCreateMenu`: Activity, Job, Client, Invoice, Quote, Inventory, Expense.
2. `PersistentTimer`: current client/activity/job, elapsed time calculated from server timestamps, pause/resume/stop.
3. `ClientTimeline`: chronological work, quote, invoice, payment, asset and note events; omit secret contents.
4. `MoneyInput`: CAD default, integer minor units internally, locale-formatted display; clear before/after tax and due amounts.
5. `StatusChip`: label plus neutral/semantic colouring.
6. `VaultSecretField`: masked by default, one-click reveal/hide, separate copy; reveal should not auto-copy.
7. `EmptyState`: clear reason and one primary action, without fictitious metrics.

## 4. Core user workflows and rules

### 4.1 Quick activity and time tracking

- From any page: `New → Activity`; choose or create client, enter brief description, manual duration or start a timer; optional billable toggle, rate override, notes, travel category and attachments; save to client without requiring a job.
- Later attach an activity to a job without losing billing history. Multiple sessions per activity/job; note each session and billable status.
- Time entries have `startedAt`, `endedAt` or manual duration, pause intervals, billable status, effective rate snapshot, rounding policy snapshot, and entry source. Store durations as integer seconds; use an explicit decimal billing-hours calculation.
- Timer backend persists state across page changes and browser restarts. One running timer at a time; safe stop/pause/resume; handle stale tabs and duplicate requests idempotently. A running timer does not silently invoice until stopped/reviewed.
- Rates: business default → client override → job override → time-entry override. User can set minimum increments (e.g. 15 minutes) and whether rounding is per entry or at invoice grouping; clearly show original versus billable duration.
- Unbilled queue groups billable activities, time entries, travel, and charges by client. Invoicing marks each source quantity/amount as allocated to prevent double billing; partial allocations require explicit support or disallow in V1.

### 4.2 Full job

- Job has client, title, description, status (`draft/open/in_progress/waiting/completed/cancelled`), optional priority, due date, quoted scope, notes, files, time, expenses, stock allocations, linked assets and invoices.
- Completing a job does not automatically issue an invoice; it flags remaining unbilled items. The user can bill multiple jobs to one client invoice.
- Client assets can be attached to jobs, with before/after technical notes and historical service timeline.

### 4.3 Quote → job/sale → invoice

- Quote draft with issue/expiry dates, line items (manual labour, fixed service, product, quantity, optional asset/stock reference), discounts, tax treatment, notes and terms. Generate downloadable PDF and send via configured SMTP.
- States: `draft/sent/accepted/declined/expired/void`. Record acceptance explicitly; do not infer it from an email. Accepted quote can create a job or directly an invoice for a resale-only purchase.
- Quote-to-invoice preserves agreed snapshot prices. Any change to scope/quantity/rates should be clearly shown, never silently rewritten.
- Invoices have draft/issued/sent/partially_paid/paid/overdue/void states; `overdue` can be derived by date and balance. Number assigned on issue using an atomic sequence with configurable prefix; no duplicate numbers. Use immutability or version/credit workflow for issued documents.
- Source references to time/charges/stock carry invoice allocation records. Partial/full payments recorded as separate append-only payment events; record method (e-transfer/cash/other), received date, note and optional reference. Balance = issued total − net applied payments/credits; validate nonnegative unless an intentional overpayment/refund workflow applies.
- Taxes configurable per line/document, including zero/exempt handling. Do not assume user is GST-registered. Business identity can be personal name or trade name, optionally logo, contact, address and registration ID.
- Store PDF bytes or versioned immutable rendering inputs exactly as sent. Email history tracks attempts, server acceptance, failures and optional message IDs, not guaranteed delivery.

### 4.4 Inventory and refurbishment

- `Product`: catalog description, category, manufacturer/model, default unit, suggested cost/sale price, notes. `StockLot` for quantity-based items; `SerializedUnit` for devices with serial/asset tag, condition, location, acquisition source/date/cost and current state.
- States include available/reserved/allocated/sold/scrapped/returned, with explicit transitions and history. Reservations do not yet count as sold. Prevent negative available quantity and double-selling one serial.
- Record stock receipts as purchase-linked acquisitions; distinguish spending cash from recognizing item cost when sold. Parts installed in a refurbished PC are consumed/transferred from stock to unit's cost basis; record labour as optional internal cost (distinct from customer-billable labour).
- Sale of a serialized unit associates its serial and sale invoice with a client and optionally creates a linked client-owned asset. Product cost and sell price are separate and never leak purchase cost to customer PDFs.
- Track client-owned devices independently, including those never sold through SideDesk; allow optional conversion from sold stock to a client-owned asset.

### 4.5 Expenses, travel and reporting

- Expense fields: vendor, date, amount, currency (CAD by default), category, description, receipt, tax component, payment method, business/client/job association, reimbursement/billable flag. A purchase can generate inventory stock without a second duplicate expense.
- Trip fields: start/end or locations (optional), kilometers, date, purpose, client/job, travel time and separate billable mileage/time rates; privacy-conscious, manual mileage is sufficient. Avoid assuming a tax deduction or CRA rate.
- Reports: received cash, invoiced sales, outstanding/overdue, expenses/purchase spend, inventory at cost, cost of goods sold, estimated gross profit, billable/unbilled time, effective hourly earnings, per-client performance, mileage, tax collected where applicable. Clearly identify accrual-like versus cash-like metrics; **not a substitute for bookkeeping advice or tax filings**.
- CSV exports for clients, work, invoices/payments, expenses, stock and mileage; PDF invoice/quote export. Sensitive vault values excluded from ordinary exports.

### 4.6 Notes and search

- Contextual rich text or safe Markdown on client/job/activity/asset/product/expense; sanitize HTML, reject script content, store attachment references. No standalone notebook in initial scope.
- Global search indexes titles, descriptions, invoice numbers, serial numbers and **nonsecret** credential metadata. Do not index usernames, recovery codes, passwords, TOTP seeds or secret custom fields.

## 5. Client credential vault — security-critical specification

### 5.1 Scope and user experience

- One personal vault integrated with SideDesk, credentials associated with clients and optionally assets/jobs. Normal SideDesk login does not unlock it.
- Separate **vault unlock password**. Vault locked on fresh login, manual lock, logout and configurable inactivity; optionally lock when backgrounded. Never persist unwrapped vault key or plaintext secrets in localStorage, sessionStorage, IndexedDB or server sessions.
- Each credential can have title, service URL, client/asset references, tags, username/email, password, notes, optional recovery codes, arbitrary user-defined fields (plain/secret), and one or more TOTP authenticators.
- On detail page, secrets masked by default. Username/email and any other stored user fields should have copy buttons; password/secret custom fields require explicit reveal to display, while copy can work without revealing. TOTP code shows only after vault unlock, counts down and refreshes (default 30 seconds; honor URI period/digits/algorithm where supported).
- Add TOTP via manual secret, pasted `otpauth://` URI, or QR upload/scan when browser access is supported. Validate Base32 secret and parameters. QR image is handled locally and not logged or uploaded unnecessarily. Allow secure storage of one-time recovery codes.
- Clear labels when locked; decide field-by-field what nonsecret metadata is stored unencrypted. Default username/email and sensitive notes are encrypted. Client and credential names may be plaintext metadata for locked-list discovery; show this in a privacy notice.
- Credential audit events: create/edit/delete, unlock attempts, reveal/copy/TOTP-copy, recovery/rotation; never log values, seeds, passwords, encrypted-derived keys or plaintext QR content. Client-side reveal/copy audit is best effort and should not be marketed as tamperproof.

### 5.2 Cryptographic design

**Login password ≠ vault password.** SideDesk account password is stored only as an Argon2id verifier with individual salt and tuned parameters. Vault password is used locally to derive a key-encryption key (KEK) using Argon2id with separate salt, versioned parameters and domain separation; never transmit or log the vault password.

**Recommended envelope architecture:**

1. On vault initialization generate random 256-bit vault master key (VMK) using a cryptographically secure generator in a secure browser context.
2. Derive KEK from separate vault password (Argon2id); wrap VMK using authenticated encryption, e.g. AES-256-GCM with cryptographically unique 96-bit nonce, key ID/version and authenticated context. Save wrapped VMK + KDF metadata on server.
3. Derive per-record encryption keys from VMK via a standard reviewed KDF (e.g. HKDF-SHA-256 with domain-separated record identifier and purpose) or generate per-record DEKs wrapped by VMK. Choose **one** consistent reviewed method; document and test it.
4. Encrypt credential payloads **in browser before sending to server**, with authenticated encryption, unique nonce per encryption under a key, version, record ID and context as associated authenticated data; ciphertext only at rest and in API body. Never reuse nonce/key pair. Prefer authenticated encryption library/Web Crypto in secure context, not homemade cryptography.
5. To unlock: derive KEK locally, unwrap VMK, decrypt only required credentials in memory. On lock destroy accessible references/clear UI state on a best-effort basis. JavaScript cannot guarantee zeroization of all memory copies.
6. Changing vault password **rewraps VMK** without re-encrypting every record. Changing the VMK requires a separate explicit rotation/re-encryption operation with transactional resilience.
7. A randomly generated high-entropy **recovery key** is presented during setup, confirmed by user, and used to wrap a separate recovery envelope for the VMK. Never store plaintext recovery key server-side. Provide recovery rehearsal/test and a clear warning that losing both vault password and recovery key means secrets cannot be recovered.

Support algorithm/KDF/key format versioning and migrations, corrupted ciphertext detection and explicit failure handling. Persist no plaintext secret outside decrypted browser state. Never implement a silent server-side plaintext fallback, even to support HTTP.

### 5.3 HTTP/HTTPS compatibility policy

- **HTTP and direct port access are supported** for the general application. Nginx, Caddy, TLS certificates and reverse proxies are **optional**.
- Setup wizard and Security Settings show a **prominent but dismissible** recommendation: “HTTPS is strongly recommended for an application storing client credentials. Without HTTPS, certain browser security features (including browser-based encryption and clipboard access) may not work. SideDesk will never disable encryption to compensate.”
- Feature-detect `window.isSecureContext`, `crypto.subtle`, a secure cryptographic random source, clipboard permissions/features and QR camera capabilities. Do not rely on URL scheme alone; localhost can be treated specially by browsers.
- If cryptographic APIs are unavailable, normal non-vault modules remain usable, but **vault setup/unlock/create/edit/reveal/copy/TOTP generation are disabled with a clear action to access the app in a secure browser context**. Existing ciphertext is not exposed through other means.
- Clipboard copy may be unavailable even in some secure contexts due to permissions; provide an honest error, not a false success toast. No hidden copy-workaround that exposes secrets or downgrades security.
- Optionally document **direct TLS termination in app** or external TLS proxy for users who choose HTTPS. Require neither for core HTTP operations.
- Treat VPN access as reducing network exposure, not as a replacement for TLS or client integrity. No security guarantee against malicious JS served by compromised host or infected endpoint.

### 5.4 Threat and data-handling requirements

- Login rate limits, Argon2id calibration, session expiration, secure cookie flags conditional on TLS, CSRF protection on cookie-authenticated mutations, strict origin/host validation, secure headers and input validation.
- Password-protected routes with no publicly routable setup after ownership creation; one active owner; optional recovery for main account separately from vault recovery.
- Restrict credential APIs to authenticated owner; even authorized API responses return ciphertext, not plaintext. Normal invoices, exports, logs, SMTP, indexing, error traces and telemetry have zero secret payloads.
- Use nonce/tag/associated-data verification; reject corrupted/tampered records with no partial display. Protect against record swapping by binding record/client identity into authenticated context.
- Avoid remote scripts/CDNs in the vault; use pinned dependencies and a restrictive Content Security Policy. Do not store keys in URLs, query strings, cookies or application logs.
- Backups include ciphertext and key envelopes, not plaintext; recovery test must verify restored vault decrypts with the original unlock/recovery credential.
- TOTP stored alongside passwords reduces factor independence if the vault is breached; disclose this tradeoff in settings/help.
- **Release gate:** Use established audited libraries, threat-model the architecture, review cryptography independently, and pass vault-specific automated tests **before entering real client credentials**. Do not claim formal audit/certification without one.

## 6. Data model (logical schema)

Use UUID or ULID primary keys, `createdAt/updatedAt`, optional `archivedAt`, account ID where needed, optimistic concurrency/version fields, and enforced foreign keys. Monetary amounts stored in integer minor units and ISO currency code (default CAD). Financial totals are calculated server-side with deterministic decimal math for tax/rate calculations. Store UTC timestamps; present user-configured `America/Edmonton` or selected local zone.

| Entity | Important fields and relationships |
|---|---|
| User, Session | Single owner, passwordHash, sessions, audit timestamps |
| BusinessSettings | Name/legal name, logo, contact, invoice numbering, payment instructions, currency, taxes, default rates/rounding, timezone |
| Client, ClientContact | Person/business, billing and contact data, status, default rate/terms, contacts |
| Job | Client FK, title, status, priority, due date, rate override, notes |
| Activity | Client FK, optional Job FK, title, billable flag, status, notes |
| Timer, TimeEntry | User, Activity/Job, starts/stops, durationSeconds, category, rate and rounding snapshots |
| Note, Attachment | Context type + validated context FK approach, sanitized body, metadata, secure storage path |
| Quote, QuoteLine, QuoteEvent | Client, versioned state, snapshots, line totals, expiry, acceptance history |
| Invoice, InvoiceLine, InvoiceAllocation | Client, number, version, issue/due, snapshot tax/amount, source allocation, immutable PDF ref |
| Payment, CreditAdjustment, EmailDelivery | Invoice reference, amount/method/date, append-only events, SMTP status |
| Product, StockLot, InventoryMovement | SKU/category, available quantity, acquisition valuation, movements |
| SerializedUnit, RefurbishmentInput | Serial/asset tag, location/condition/state, costs, consumed parts, linked sale |
| ClientAsset, AssetServiceLink | Client-owned device, serial/specs, sold-unit origin, jobs/history |
| Expense, ExpenseAttachment | Vendor, category, total/tax/currency, client/job link, receipt |
| Trip, TravelCharge | Distance, duration, mileage rate, travel labour rate, client/job link |
| TimelineEvent, GeneralAudit | Type, actor, linked record, timestamp, safe summary |
| Vault, VaultKeyEnvelope, VaultRecoveryEnvelope | Algorithm/version, salt and KDF params, wrapped master key, recovery state |
| Credential, CredentialEncryptedPayload | Client/asset references, nonsecret title, ciphertext, nonce, key version, authenticated context |
| CredentialAuditEvent | Operation type, credential reference, timestamp, no secret values |

Do **not** duplicate financial effects: a purchase linked to inventory represents one outflow plus acquired inventory; selling stock consumes the asset cost basis for profitability. Use state transitions and allocation constraints enforced in database transactions. For credential custom fields and TOTP, prefer encrypted **structured payloads inside the credential ciphertext**, or separate encrypted tables if there is a justified requirement; never make secret values ordinary unencrypted columns.

### Proposed relational invariants

- Unique `(business, issuedInvoiceNumber)`; counters allocated transactionally on issue.
- Unique serialized unit serial within an appropriate vendor/product scope if serial present; allow explicit override for known duplicates/unknown values.
- One serialized unit cannot have two simultaneous active sale allocations.
- Quantity movement never creates negative sellable stock; correction movements are recorded, not silently overwritten.
- Billed time/expense/stock allocations cannot exceed remaining unbilled quantity/value.
- Payments/credits cannot silently alter original issued invoice totals.
- Credential ciphertext cannot be joined to ordinary client list responses by default.

## 7. Recommended technical implementation

| Layer | Choice | Notes |
|---|---|---|
| Web frontend | Next.js + React + TypeScript | App Router or maintained equivalent; responsive SSR/client interaction |
| UI | Tailwind CSS + shadcn/ui primitives | Token-based light/dark styles, accessible table/dialog/form primitives |
| API | Same Next.js deployment with typed server handlers | Separate service layer for business rules and transactions |
| Database | PostgreSQL | Relational integrity, transactional invoices and stock movements |
| ORM | Prisma **or** Drizzle | Choose one; maintain explicit migrations and integrity constraints |
| Validation | Zod or equivalent | Validate all HTTP inputs and persisted domain events |
| File storage | Private persistent local storage | Nonpublic server storage; authenticated file endpoint; optional S3 later |
| PDF | HTML-to-PDF with server-controlled template | Printed A4/Letter page-safe, snapshot stored |
| Email | Configurable SMTP transport | Credentials stored encrypted at rest using a deployment-managed app secret; test endpoint |
| Cryptography | Well-maintained vetted browser libs / Web Crypto | Argon2id KDF, AES-256-GCM AEAD, HKDF/standard envelope design |
| Deployment | Docker Compose | App + Postgres + persistent file storage; optional TLS/reverse proxy |
| Testing | Unit, integration, e2e, security | Playwright for browser workflows and cross-theme states |

### Repository layout proposal

```text
sidedesk/
  app/                    # pages/layouts and server actions/routes
  components/             # reusable design system, forms, tables, vault UI
  features/               # clients, work, sales, stock, expenses, vault, reports
  lib/                    # validation, auth, money, time, security, email
  db/                     # schema, migrations, seeds
  public/                 # static local assets only
  scripts/                # maintenance, backup, restore
  tests/                  # unit / integration / e2e / vault security
  docs/                   # architecture, threat model, deployment, user guide
  compose.yaml
  Dockerfile
  .env.example
  README.md
```

## 8. First-run onboarding, configuration and deployment

### First-run wizard

1. Welcome; explain single-user, private deployment, backup responsibilities.
2. Create owner login and password (Argon2id); setup closes to unauthenticated callers once complete.
3. Display HTTPS recommendation clearly; detect current security context and explain vault limitations under HTTP. **Do not block basic app onboarding.**
4. Set business identity (personal or business name), timezone, CAD currency, default hourly rate and rounding, invoice prefix, tax enabled/disabled and registration details where applicable.
5. Configure storage/backup destination and run backup test; SMTP optional, test email optional.
6. Set up vault **only in a supported secure browser context**: separate vault password, create encrypted key envelopes, show recovery key once, require recovery key confirmation; alternatively postpone vault creation with prominent status.
7. Land on a purposeful empty dashboard with clear `Add client` and `Log activity` buttons.

### Docker Compose contract

- `app` and `postgres` services; DB network private; bind app to configurable host/port (document loopback/LAN exposure). No default database host-port mapping.
- Secrets and keys from environment/secret files; no production default admin password or baked-in SMTP credentials.
- Persistent volumes for database and uploads; health checks; restart policy; server-side migration strategy that does not destroy data.
- Example environment names: `APP_URL`, `APP_PORT`, `DATABASE_URL`, `SESSION_SECRET`, `FILE_STORAGE_PATH`, `TZ`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `BACKUP_DIR`.
- Backups: consistent database dump + uploaded documents + configuration/version manifest + encrypted vault envelopes; optional scheduled backup job, retention, off-host copy; script and written steps for tested restore.
- Logging includes startup, diagnostics and failures without sensitive data. Document update, rollback, key persistence and disaster recovery.
- Optional documented Caddy/Nginx/Traefik/TLS route or direct HTTPS mode, never a required dependency. Recommend access-control/firewall/VPN and discouraging public exposure.

## 9. Invoice and quote document specification

**Visual:** One polished professional printable template, neutral typography, crisp accent colour configurable, optional logo, A4 and Letter compatible, no theme switching in printed output. Show large `INVOICE` or `QUOTE` heading, issuer, recipient, document number, dates, itemized table, subtotal, optional discounts, tax rows, grand total in CAD, amount received/balance due for invoices, notes/terms/payment instructions and optional registration number. Include page numbers and repeating table headings for multipage invoices; no layout overlap at large item counts.

**Editor:** Contact picker, contextual source suggestions, add/reorder/customize item rows, quantities, unit rates, optional discount/tax per line, preview before issue, generate PDF, email via SMTP, mark sent only on accepted SMTP response, record payments, download the exact issued snapshot. For quote, include expiry and acceptance state. Product purchase/acquisition cost must never appear on customer-facing PDFs unless explicitly typed as a customer-visible line item.

## 10. Milestone plan and exit criteria

### Milestone 0 — Architecture and skeleton

**Deliver:** design tokens and responsive shell, monorepo or structured app, Docker Compose, PostgreSQL migrations, auth and setup wizard, CI, test scaffolding, threat model and key-management architecture. **Gate:** one owner can securely onboard; app starts with documented commands; both themes work; no default credentials; HTTPS message appears over HTTP.

### Milestone 1 — Foundational vault, clients and activities

**Deliver:** vault creation/unlock/recovery envelope, CRUD for encrypted client credentials, custom fields and TOTP, reveal/copy and lock controls; client/contact pages; contextual notes; quick activities; persistent timer/time entries; vault-sensitive audit event design. **Gate:** ciphertext-only server storage proven, HTTP feature restrictions proven, recovery rehearsal passes; user can create a client and record timed/manual work; no vault plaintext in log/API/database.

### Milestone 2 — Jobs and invoicing

**Deliver:** structured jobs, unbilled queue, rate hierarchy, rounding, drafts, issue sequence, polished PDF, payments, invoice snapshots and allocations. **Gate:** cannot double-bill a source entry, two simultaneous invoice issuances cannot duplicate numbers, issued invoices cannot silently change, cash/balance math correct.

### Milestone 3 — Quotes, SMTP and expenses/travel

**Deliver:** quote lifecycle and conversion, configurable tax settings, SMTP send history, expenses/receipts, mileage/travel time and charges. **Gate:** conversion preserves quote snapshots; bad SMTP credentials do not mark sent; client charge versus business expense handled distinctly; partial payments and credits preserve audit history.

### Milestone 4 — Inventory and client assets

**Deliver:** products, lots/quantity stock, serialized units, stock movements, acquisition/repair cost basis, serialized sales, client asset creation and service history. **Gate:** unit cannot be sold twice, quantity cannot go negative, stock-to-client traceability works, parts/expenses not double counted.

### Milestone 5 — Reports, search, polish and hardening

**Deliver:** comprehensive reports, CSV exports, global safe search, unified timeline, UI polish, backups/restore test automation, keyboard navigation, mobile usability, threat-model reassessment. **Gate:** reports reconcile with fixtures; complete restore including vault; accessible light/dark UI; security checks passed. Any real-world credential use still requires independent security review.

### Do not claim completion unless

Every milestone provides: working Docker build; migration; README changes; tests for new domain invariants; sample anonymized seed data; a short demo/checklist; no knowingly broken navigation or placeholder buttons. Codex must stop and report blockers instead of quietly reducing vault security or fabricating implemented features.

## 11. Test matrix and acceptance criteria

| Area | Acceptance test |
|---|---|
| Quick work | Create client + 25-minute billable activity without creating job; invoice it once; attempt re-invoice prevented |
| Timer | Start, navigate, refresh, pause, resume, stop; elapsed time consistent with server timestamps |
| Rate hierarchy | Business/client/job/entry overrides and rounding produce independently verified totals |
| Quotes | Accepted quote can create job or invoice; historical quoted price remains unchanged |
| Invoice | Unique sequential ID under concurrency; PDF matches issued snapshot; partial payment adjusts balance only |
| Taxes | Disabled tax yields none; optional configured tax per line totals correctly; negative/invalid rates rejected |
| Inventory | Receive six serial units, consume refurb SSDs, sell six, record exact buyer/serials; seventh sale rejected |
| Expenses | Buying stock creates one purchase and stock movement, not two cash outflows |
| Assets | A sold serialized unit appears as a client-owned asset with service history |
| Vault at rest | Inspect DB, API responses and logs for known secret markers: plaintext absent |
| Vault lock | Fresh login locked; idle/logout locks; secrets inaccessible until separate unlock |
| Vault crypto | Wrong password, tampered nonce/tag, swapped record identity all fail closed |
| Vault recovery | Restore DB backup, enter recovery key, recover vault and set new unlock password |
| TOTP | Known RFC test vectors generate correct codes under test-controlled time; default 30-second UI rollover |
| HTTP vs HTTPS | HTTP dashboard/work/invoicing usable; unsupported vault capability clearly blocked, not downgraded |
| Clipboard | Copy UI reflects actual success/failure, never reports success without permission |
| Email | Failing SMTP does not mark invoice delivered; successful submission logs SMTP acceptance only |
| Theme/accessibility | Core screens pass keyboard and light/dark checks on mobile and desktop |
| Restore | Restore application DB/files/key envelopes into fresh Compose deployment with consistent references |

## 12. Codex execution instructions (copy directly as agent brief)

> Read this entire specification and treat all binding decisions and security constraints as requirements. Before implementation, produce an architecture summary, proposed schema, security threat model, milestone breakdown and any blocking assumptions. Proceed in milestones, each resulting in a runnable Docker deployment and tests. Favor maintainable conventional code and well-supported dependencies. Do not introduce multi-user complexity, require HTTPS/reverse proxy for general application use, or sacrifice vault encryption to make HTTP work. Treat the client credential vault as security-critical: separate unlock password, client-side encryption, versioned key envelopes, recovery mechanism, secure-context detection and fail-closed behavior. Never invent test results. If a browser or library limitation prevents a secure feature, disable it clearly and document the constraint. Use fictional sample data only. Follow the UI guidelines closely, including equally supported light/dark themes. Preserve financial and inventory auditability, snapshots and transactional invariants.

## 13. Open implementation choices (not unresolved product requirements)

Codex may select a maintained ORM, PDF rendering engine, Argon2id browser implementation, secure storage architecture and UI charting library after documenting tradeoffs. Decisions must respect the security model and be recorded in `docs/architecture-decisions.md`. A production security review remains necessary before storing actual client secrets.

---

**End of specification — SideDesk v1.0.**
