import { randomUUID } from "node:crypto";
import { transaction, pool } from "../lib/db";
import { saveDraft } from "../features/billing/service";
import { saveQuote, quoteInput } from "../features/quotes/service";
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
  await saveQuote(
    db,
    quoteInput.parse({
      client_id: client,
      issue_date: "2026-10-23",
      expiry_date: "2026-11-22",
      notes: "Fictional sample proposal",
      lines: [
        {
          kind: "manual",
          description: "Fictional follow-up installation",
          quantity: "1",
          unit_minor: 25000,
        },
      ],
    }),
    randomUUID(),
  );
  const expense = randomUUID();
  await db.query(
    "INSERT INTO expense(id,vendor,spent_on,amount_minor,tax_minor,category,description,payment_method,client_id,job_id,billable,recovery_minor) VALUES($1,'Fictional supply shop','2026-10-23',10500,500,'Supplies','Fictional client supplies','other',$2,$3,true,12000)",
    [expense, client, job],
  );
  await db.query(
    "INSERT INTO client_charge(id,client_id,job_id,expense_id,kind,description,amount_minor,snapshot) VALUES($1,$2,$3,$4,'expense','Fictional supplies recovery',12000,$5)",
    [
      randomUUID(),
      client,
      job,
      expense,
      JSON.stringify({
        vendor: "Fictional supply shop",
        spent_on: "2026-10-23",
        recovery_minor: 12000,
      }),
    ],
  );
  await db.query(
    "INSERT INTO trip(id,travelled_on,purpose,distance_milli_km,duration_seconds,mileage_rate_minor,time_rate_minor,rounding_minutes,client_id,job_id) VALUES($1,'2026-10-23','Fictional assessment visit',10125,720,70,15000,15,$2,$3)",
    [randomUUID(), client, job],
  );
});
await pool().end();
console.log(
  "Fictional client, job, activities, timed work, quote/invoice drafts, expense recovery and manual trip created. No owner password or vault secrets seeded.",
);
