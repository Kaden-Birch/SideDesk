import { randomUUID } from "node:crypto";
import { transaction, pool } from "../lib/db";
if (process.env.ALLOW_FICTIONAL_SEED !== "yes")
  throw new Error("Set ALLOW_FICTIONAL_SEED=yes for a demo deployment only");
await transaction(async (db) => {
  if ((await db.query("SELECT id FROM client")).rowCount)
    throw new Error("Demo seed requires an empty client list");
  const id = randomUUID();
  await db.query(
    "INSERT INTO client(id,name,type,email) VALUES($1,'Prairie Demo Studio','business','demo@example.invalid')",
    [id],
  );
  await db.query(
    "INSERT INTO activity(id,client_id,title,billable) VALUES($1,$2,'Fictional workstation assessment',true)",
    [randomUUID(), id],
  );
});
await pool().end();
console.log(
  "Fictional client and activity created. No owner password or vault secrets seeded.",
);
