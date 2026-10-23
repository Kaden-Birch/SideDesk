import { randomUUID } from "node:crypto";
import { transaction, pool } from "../lib/db";
import { saveDraft } from "../features/billing/service";
import { draftInput } from "../features/billing/model";
if (process.env.ALLOW_FICTIONAL_SEED !== "yes")
  throw new Error("Set ALLOW_FICTIONAL_SEED=yes for a demo deployment only");
await transaction(async (db) => {
  if ((await db.query("SELECT id FROM client")).rowCount)
    throw new Error("Demo seed requires an empty client list");
  if (!(await db.query("SELECT singleton FROM business_settings")).rowCount)
    throw new Error(
      "Create the owner and business settings before demo seeding",
    );
  const client = randomUUID(),
    job = randomUUID(),
    activity = randomUUID(),
    entry = randomUUID();
  await db.query(
    "INSERT INTO client(id,name,type,email) VALUES($1,'Prairie Demo Studio','business','demo@example.invalid')",
    [client],
  );
  await db.query(
    "INSERT INTO job(id,client_id,title,description,hourly_rate_minor) VALUES($1,$2,'Fictional workstation refresh','Assess two demo workstations and document recommendations.',15000)",
    [job, client],
  );
  await db.query(
    "INSERT INTO activity(id,client_id,job_id,title,billable) VALUES($1,$2,$3,'Fictional workstation assessment',true)",
    [activity, client, job],
  );
  await db.query(
    "INSERT INTO time_entry(id,activity_id,job_id,duration_seconds,billable,source,rate_minor,rounding_minutes,rounding_scope,rate_source) VALUES($1,$2,$3,1500,true,'manual',15000,15,'entry','job')",
    [entry, activity, job],
  );
  await saveDraft(
    db,
    draftInput.parse({
      client_id: client,
      issue_date: "2026-10-23",
      due_date: "2026-11-22",
      notes: "Fictional demonstration only",
      lines: [
        {
          kind: "time",
          description: "Workstation assessment",
          source_ids: [entry],
        },
      ],
    }),
    randomUUID(),
  );
  await db.query(
    "INSERT INTO activity(id,client_id,title,billable) VALUES($1,$2,'Fictional follow-up call',true)",
    [randomUUID(), client],
  );
});
await pool().end();
console.log(
  "Fictional client, job, activities, timed work and invoice draft created. No owner password or vault secrets seeded.",
);
