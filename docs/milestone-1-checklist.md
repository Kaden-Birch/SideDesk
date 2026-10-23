# Milestone 0 + 1 acceptance checklist

Status: functional Milestone 0 foundation and Milestone 1 complete. Independent review before real client credentials remains a separate release gate.

## Functional demo

1. Start a fresh Compose deployment with unique secrets and the exact APP_URL. Create one owner using the deployment setup token. A second owner claim must fail.
2. Dismiss the HTTPS recommendation; find it again in Security Settings. Toggle system/light/dark themes. Check mobile navigation and keyboard focus.
3. Create a fictional client and contact. Add a Markdown note; script/raw HTML must not execute. Edit client details without losing references.
4. Log a 25-minute billable activity directly to the client without a job. Confirm rate/rounding snapshots. Start another timer, navigate/refresh, pause, resume, stop; no duplicate entry after retry.
5. In a secure-capable browser create a separate vault password, save the recovery key offline, and confirm the complete key. Add username/password, custom fields, recovery codes and TOTP. Password/secret fields remain masked until reveal; copy can operate without reveal.
6. Inspect wire/storage/logs for fictional secret markers. Ordinary client responses contain discovery metadata only; dedicated credential responses contain ciphertext only.
7. Test wrong unlock password, corrupt ciphertext and record/client substitution. No partial secrets should display. Rewrap the password, lock and unlock with the new password. Original credential ciphertext remains decryptable without a mass rewrite.
8. Test recovery rehearsal and actual recovery with a new password and newly confirmed recovery key. Reload/fresh login/idle/hidden/navigation/manual/cross-tab lock remove access to decrypted state.
9. Deny clipboard permission: failure is visible and no copied success is reported. Test manual TOTP, supported URI parameters and local QR input. Unsupported camera access offers manual/file alternatives.
10. Open a real non-loopback HTTP origin: client/work/timer operations work, vault setup/unlock/reveal/copy/edit/TOTP do not. Localhost alone cannot prove this gate.
11. Back up, verify checksum manifest, restore into a fresh database and restore private files. Revoke restored sessions; log in, recover the restored vault and decrypt a fictional item.

## Automated evidence

- Unit/cryptographic and real PostgreSQL integration tests: `npm test`.
- Production browser acceptance, light/dark accessibility and phone screenshots: `npm run build && npm run test:e2e`.
- Docker fresh build/onboarding/ciphertext backup/manifest/fresh restore/recovery: `npx tsx scripts/docker-smoke.ts` in a disposable environment without an existing `.env`.
- Type check and lint: `npm run typecheck && npm run lint`.
- CI uploads browser evidence and must pass both verify and docker jobs.

## Known boundaries

No jobs, quotes/invoices, PDF billing, payments, SMTP, inventory, expenses or reports are implemented. Time/rate/rounding snapshots exist; invoice application comes in M2. No automatic off-host backups/retention or user-facing master-key rotation. No independent crypto audit has been obtained. Audit of browser reveal/copy is best effort.

## Recorded validation — 23 October 2026

Application commit `6ddb0cf` passed [GitHub Actions run 39988368389](https://github.com/Kaden-Birch/SideDesk/actions/runs/39988368389): both `verify` and `docker` succeeded on Linux/Node 24. The suite contains 24 passing unit/cryptographic/PostgreSQL tests and three passing production-browser workflows. Browser checks include light/dark axe accessibility, phone overflow, separate vault unlock, recovery/rewrap, idle and broadcast lock, clipboard denial, no unexpected API 5xx, and ordinary HTTP activity/timer operation with vault restrictions.

Docker evidence includes fresh image build, migrations, owner onboarding, ciphertext-only credential upload, consistent database/files backup, checksum verification, fresh database restore, file restoration, restored session revocation, login and recovery-key decryption of a restored fictional credential. Local Node 25/macOS checks also passed: clean npm install, typecheck, lint, formatting, production build, 24 tests and three browser workflows. Desktop light/dark and phone screenshots were visually inspected.

The final handoff changes documentation and the footer disclosure; main receives the same CI gates. No real client secrets or independent-audit claim are included. Stop after M1; M2 needs the user's confirmation.
