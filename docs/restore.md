# Restore rehearsal into a fresh deployment

Use a separate checkout/Compose project and new volumes. Commands below assume the backup directory has `database.dump`, `uploads/`, `manifest.json`. Back up the original `.env`/deployment secrets separately; never commit them.

1. Verify `manifest.json` file hashes with SHA-256. Reject missing, extra/untrusted paths or changed bytes. Check the application version and PostgreSQL dump compatibility. Do not restore an unknown backup into a live instance.
2. In the new deployment set matching configuration and a new host port, retain original deployment keys, build the matching image, then start only PostgreSQL:

   ```sh
   docker compose build
   docker compose up -d postgres
   docker compose exec postgres pg_isready -U sidedesk -d sidedesk
   ```

3. Restore into the new empty database (adjust the local backup path):

   ```sh
   docker compose exec -T postgres pg_restore -U sidedesk -d sidedesk --no-owner --exit-on-error < /absolute/backup/database.dump
   docker compose exec -T postgres psql -U sidedesk -d sidedesk -c 'UPDATE session SET revoked_at=now();'
   ```

4. Copy the restored upload tree into the new upload volume. Create the app container without starting it first with `docker compose create --no-deps app`; `/data/uploads` is its private volume. Use `docker compose cp /absolute/backup/uploads/. app:/data/uploads` then ensure the tree is owned by container user `node` (uid 1000). File permissions must not make uploads publicly served.
5. Apply migrations, then start the new app:

   ```sh
   docker compose run --rm migrate
   docker compose up -d app
   ```

6. Log in with the restored owner account, inspect business/client/work records and files. The vault must start locked. Enter the original recovery key, perform recovery into a new password and newly confirmed recovery key, then decrypt a restored credential. Test a wrong key too. Do not call a backup verified until this succeeds.
7. Record original application commit/version, backup timestamp, checksum results and success/failure without secret contents. Delete test deployment/volumes only after confirming they are the disposable project.

CI's Docker smoke test automates a fresh database restore, file restoration, session revocation and decrypt/recovery verification with fictional values. Manual restore documentation does not by itself prove a run succeeded; see the milestone checklist for recorded evidence.

## Milestone 3 restore additions

Preserve the original `SMTP_ENCRYPTION_KEY` separately from the backup, and any operator-mounted `SMTP_CA_FILE`. Restore them before using authenticated SMTP. The restored settings API must still expose only password presence. A missing/wrong key must fail closed; it does not affect client-vault recovery. Explicitly re-entering the SMTP password can replace an unreadable envelope under a new key.

Verify a published quote's exact PDF bytes, accepted state and active/historical conversion links; an issued invoice's original bytes, credits/tax components, refunds, outstanding and refundable balance; an expense receipt download and trip/expense full-charge allocations. Recover the original vault using its separate browser-held recovery credential as before.

Inspect pending/unknown email attempts against the actual mail server. Restore never retries them automatically, and neither pending nor unknown proves the email was not delivered. Test connection/authentication before explicitly sending a new message; a connection test itself sends no email. Migration 0003 is additive but application downgrade to M2 is unsupported; rollback uses a compatible backup in a fresh deployment.
