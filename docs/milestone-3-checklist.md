# Milestone 3 acceptance checklist

Scope: quotes, taxes, SMTP, expenses/travel and auditable credits/refunds. M4 is not authorized. Fictional fixtures only; independent vault review remains a separate release gate.

## Functional demo

1. Configure a named tax profile with independent/compounded components and three-decimal percentages. Do not infer registration. Apply to a line or explicitly to all draft lines, then override a zero/exempt line. Save twice. Verify exact component cents; changing a profile does not silently change snapshots.
2. Create a quote with client/contact, dates/expiry, manual service/product lines, quantities/rates, discounts, taxes, notes and terms. Preview Letter/A4. Publish: number, parties, prices and PDF freeze. Direct edits fail; create a new revision linked to its predecessor.
3. Expire a published quote; acceptance is blocked until revision. Record explicit acceptance evidence on a valid quote. Email acceptance alone never accepts a quote.
4. Convert concurrently to an invoice/job: duplicate active conversion is prevented, agreed snapshot prices/taxes survive changed settings. Saved draft departures are clearly compared with the accepted quote. Discard/void allows a new active invoice with old links/history retained.
5. Configure SMTP with a dedicated deployment encryption key. Verify safe API/DB storage and missing/wrong/corrupt-key failure. Test connection/authentication without sending. Plain relay cannot use credentials; TLS verification cannot be disabled.
6. Email the exact published PDF to a fictional local SMTP fixture. Bad credentials record failure without sent status; accepted submission records server acceptance/hash and sent status. Repeated request keys do not resend. Ambiguous failure records unknown and requires explicit review. No delivery guarantee or real-recipient test.
7. Record vendor cost including tax and a separate customer recovery. Business-only expenses create no billable charge. Attach/download a private receipt; anonymous access fails. Add a safe Markdown expense note. Corrections require a reason; allocated cost records cannot change.
8. Record manual distance, duration, purpose, optional locations/client/job, mileage rate and travel labour rate/rounding. Verify 10.125 km × CAD 0.70 = CAD 7.09 and 12 minutes rounded to 15 × CAD 100/h = CAD 25.00. No assumed CRA rate/deduction.
9. Invoice full recovery/mileage/labour charges. Concurrent duplicate drafts and partial allocations fail. Discard/void releases reservations. Job/client/source links remain usable. Vendor cost is not automatically copied as invoice revenue.
10. Record partial/full receipts, credits with explicit included tax, external refunds and reversals. Bound total/tax/pretax credit and refundable cash independently under races. Net cash/outstanding/customer credit reconcile. Original issued totals/PDF bytes never change. No bank transfer is initiated.
11. Check quote, invoice, tax, SMTP, expense/trip/receipt and charge forms in light/dark, keyboard and phone layouts. Ordinary HTTP expense/quote/invoice functions work while unsupported vault operations remain blocked.
12. Fresh Docker build/migrations, backup checksum verification, fresh database/files restore, session revocation and vault recovery. Verify quote PDF/conversion, expense receipt, travel/charge reservations, credit/refund balances and a restored encrypted SMTP envelope using the preserved deployment key. Pending mail attempts never auto-send.
13. Opt-in empty-client demo seed creates fictional quote/invoice drafts, job/time, expense recovery and manual trip, with no default owner/vault or SMTP credentials.

## Verification commands

`npm ci`, `npx playwright install chromium`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, `npm run test:e2e`. Docker smoke runs only in a disposable environment without an existing `.env`. Main runs Linux/Node 24 verify and Docker gates. Actual successful run links are recorded at handoff.

Local fixtures cover Letter and seven-page A4 quote PDFs; every rendered page was visually reviewed for headers, tables, totals and clipping. Browser coverage includes a real disposable TLS SMTP fixture, failed/successful email states, conversion and financial corrections, private receipts, job links and phone/ordinary-HTTP charges. All prior vault/security tests remain enabled.

## Known boundaries

CAD only; manual mileage; no client portal, delivery/read tracking, public acceptance endpoint, bank transfers, standalone credit-note PDF, automated tax filing, stock/assets or comprehensive reports. Full-source allocation only. Ordinary receipts/job files are not vault-encrypted. No off-host scheduling/retention or independent cryptographic audit is claimed. M2 → M3 migration is non-destructive; application downgrade is unsupported. Keep SMTP deployment keys/CA configuration separately from backups.

Milestone 4 needs a new user confirmation.

## Recorded local validation — 23 October 2026

Release 0.3.0 passed a clean `npm ci`, formatting, typecheck, lint, all 60 unit/cryptographic/PostgreSQL/PDF/seed tests, production build and all seven production-browser workflows on macOS/Node 25. The seven browser flows include original vault/HTTP gates, real local TLS SMTP rejection/acceptance, quote/job/invoice conversion, explicit tax components, partial receipts, credits/refunds and their reversals, void history and replacement quote invoices, private receipts, job-linked travel/expense allocations and ordinary HTTP finance with the vault blocked. Light/dark axe checks and phone overflow checks passed. Updated desktop/phone screenshots were visually inspected.

Letter and seven-page A4 quote PDFs were rendered with Poppler; every page was visually inspected for legibility, repeating headers, tax totals, page counts and overlap. The master specification checksum is unchanged. Local Docker daemon is unavailable; the Linux Docker/restore gate must pass in GitHub Actions before main advances. No real emails or client secrets were used.

## Recorded Linux and Docker acceptance — 23 October 2026

[Candidate acceptance run 40031279094](https://github.com/Kaden-Birch/SideDesk/actions/runs/40031279094), commit `bfb347187be514ec24e8020bdc98386ae2a67957`, passed both jobs on Linux/Node 24: typecheck, lint, all 60 tests in seven files, production build and all seven browser workflows. Docker passed fresh build/migration, immutable invoice/quote PDFs, quote conversion, private expense receipts, mileage/travel charges, credits/refunds, encrypted SMTP settings, consistent backup, fresh database/file restore and vault recovery.

The initial candidate exposed a login race under slower responses: completing the data refresh could send an already-navigating user back to Overview. The landing navigation now happens before authenticated data loads. The ordinary-HTTP browser test deliberately holds the client response until after navigation and verifies that the chosen view remains usable. All seven browser workflows passed locally and on Linux after the correction. Vault encryption and HTTP restrictions remain unchanged.
