import { passwordHash } from "../lib/auth";
import { pool, transaction } from "../lib/db";
// Operator-only: supply password on stdin, never command line; all sessions revoked.
let input = "";
for await (const chunk of process.stdin) input += chunk;
const password = input.trimEnd();
if (password.length < 14 || password.length > 256)
  throw new Error("Use 14–256 characters on stdin");
const hash = await passwordHash(password);
await transaction(async (db) => {
  await db.query("UPDATE owner SET password_hash=$1,updated_at=now()", [hash]);
  await db.query("UPDATE session SET revoked_at=now()");
});
await pool().end();
console.log(
  "Owner password reset; sessions revoked. Vault remains locked and unchanged.",
);
