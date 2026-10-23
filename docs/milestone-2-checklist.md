# Milestone 2 acceptance checklist

Scope: jobs and invoicing. M3 is not authorized. Use fictional records only; independent review remains required before actual vault secrets.

## Demo

1. Create a client, structured job, scope, due date and rate. Attach an activity, job note and private file. Download the file while authenticated; anonymous access must fail.
2. Log direct-client and job time. Change business/client/job rates; existing entries retain snapshots. Review an unallocated rate with a correction reason. Start/pause/resume/stop timer; its start snapshot survives.
3. Select stopped billable time in Unbilled. Create a draft; duplicate selection in another draft fails. Incompatible historical rates/rounding scopes stay separate. Confirm entry/group rounding against known seconds.
4. Edit description, manual quantity/rate, discount, per-line tax, contact, notes and terms. Save twice, reorder lines and preview. Check taxes disabled/enabled and exact cents. Discard releases all reservations.
5. Issue concurrent drafts; numbers must differ and remain sequential. Simulate failed rendering; no issued state or consumed number. Retrying the same request cannot issue twice.
6. Download Letter and multipage A4 PDFs. Check identity, line items, tax/discount totals, notes/instructions, repeat headers and page counts. No HTML execution/network dependency, clipping or overlap.
7. Edit client/settings after issue. Issued totals/identity/PDF bytes remain identical. Direct SQL attempts to edit issued lines or allocated time fail.
8. Record partial then final payment. Cash received/outstanding balance reconcile. Reject overpayment and concurrent excess receipts. Correct an erroneous receipt with a reasoned full reversal, preserving both events.
9. Void an unpaid invoice with a reason. Original PDF stays identical; sources return to Unbilled. Paid invoices require correction first. No refund transfer is claimed.
10. In both themes, keyboard through jobs/invoices/payment dialogs and test 390 px phone layouts. Ordinary non-loopback HTTP invoicing/PDF works while vault operations remain unavailable.
11. Fresh Docker build/migrate; back up and verify manifest; restore into a fresh DB/upload tree; revoke sessions. Verify job file, issued PDF bytes, payment balance, source allocation and recovered vault secret.
12. Opt-in demo seed on an empty onboarded deployment creates a fictional job/time/invoice draft, never an owner or vault.

## Evidence and boundaries

Run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, `npm run test:e2e`. CI also runs disposable Docker build/backup/restore. The final handoff records the actual successful CI run; do not infer success from this checklist.

PDF fixtures cover Letter and six-page A4 with visual review of every page. Browser checks include light/dark axe scans, phone overflow, draft repeat saves, file downloads, exact cents, immutable PDFs, payments and ordinary HTTP restrictions. Database tests cover allocation/number/payment races, immutable records and renderer rollback. Original vault tests remain enabled.

No quotes, SMTP, automatic tax rules, credits/refunds, expenses/travel, stock/assets or comprehensive reports yet. Logo upload, partial source allocation and off-host scheduled backup are unavailable. Ordinary files are not encrypted vault attachments. M1 → M2 migration is non-destructive; code downgrade is unsupported. Restore a compatible backup into a fresh deployment for rollback.
