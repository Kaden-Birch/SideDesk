import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, transaction } from "@/lib/db";
import { requireValue } from "@/lib/auth";
import { once } from "@/lib/http";
import { id, text, rate } from "@/lib/validation";
import { date } from "@/features/billing/model";
import {
  divideRound,
  safeMinor,
  roundSeconds,
  timeAmounts,
} from "@/features/billing/money";
const association = {
  client_id: id.nullable().default(null),
  job_id: id.nullable().default(null),
};
export const expenseInput = z
  .object({
    ...association,
    vendor: text(160),
    spent_on: date,
    amount_minor: z.number().int().min(0).max(100000000000000),
    tax_minor: z.number().int().min(0).max(100000000000000).default(0),
    currency: z.literal("CAD").default("CAD"),
    category: text(80),
    description: z.string().max(4000).default(""),
    payment_method: z
      .enum(["e_transfer", "cash", "cheque", "credit_card", "debit", "other"])
      .default("other"),
    billable: z.boolean().default(false),
    recovery_minor: z.number().int().min(0).max(1000000000).default(0),
    version: z.number().int().positive().optional(),
    change_reason: z.string().trim().max(1000).default(""),
  })
  .strict()
  .refine(
    (p) => p.tax_minor <= p.amount_minor,
    "Tax cannot exceed the tax-inclusive expense total",
  )
  .refine((p) => !p.job_id || p.client_id, "Choose a client for the job")
  .refine((p) => !p.billable || p.client_id, "Choose a client for recovery")
  .refine(
    (p) => p.billable || p.recovery_minor === 0,
    "Business-only costs have no customer charge",
  );
export const tripInput = z
  .object({
    ...association,
    travelled_on: date,
    purpose: text(500),
    origin: z.string().max(300).default(""),
    destination: z.string().max(300).default(""),
    distance_milli_km: z.number().int().min(0).max(100000000),
    duration_seconds: z.number().int().min(0).max(31536000),
    mileage_rate_minor: z.number().int().min(0).max(100000),
    time_rate_minor: rate,
    rounding_minutes: z.union([
      z.literal(1),
      z.literal(5),
      z.literal(6),
      z.literal(10),
      z.literal(15),
      z.literal(30),
      z.literal(60),
    ]),
    billable_mileage: z.boolean().default(false),
    billable_time: z.boolean().default(false),
    version: z.number().int().positive().optional(),
    change_reason: z.string().trim().max(1000).default(""),
  })
  .strict()
  .refine((p) => !p.job_id || p.client_id, "Choose a client for the job")
  .refine(
    (p) => !(p.billable_mileage || p.billable_time) || p.client_id,
    "Choose a client to bill travel",
  );
export type Expense = z.infer<typeof expenseInput> & {
  id: string;
  version: number;
  client_name: string | null;
  allocated: boolean;
  notes?: { id: string; body: string }[];
};
export type Trip = z.infer<typeof tripInput> & {
  id: string;
  version: number;
  client_name: string | null;
  allocated: boolean;
  mileage_minor: number;
  travel_minor: number;
};
export type Charge = {
  id: string;
  client_id: string;
  client_name: string;
  job_id: string | null;
  expense_id: string | null;
  trip_id: string | null;
  kind: "expense" | "mileage" | "travel_time";
  description: string;
  amount_minor: string;
  snapshot: Record<string, unknown>;
};
export async function costList(context: "expense" | "trip") {
  const fk = context + "_id";
  return (
    await pool().query(
      `SELECT s.*,${context === "expense" ? "s.spent_on::text" : "s.travelled_on::text"},c.name AS client_name,EXISTS(SELECT 1 FROM client_charge ch JOIN charge_allocation a ON a.charge_id=ch.id WHERE ch.${fk}=s.id AND a.released_at IS NULL) AS allocated FROM ${context} s LEFT JOIN client c ON c.id=s.client_id WHERE s.archived_at IS NULL ORDER BY s.${context === "expense" ? "spent_on" : "travelled_on"} DESC,s.created_at DESC`,
    )
  ).rows;
}
export async function costDetail(context: "expense" | "trip", rid: string) {
  const rows = await costList(context),
    r = rows.find((s) => s.id === rid);
  requireValue(r, 404, "Record not found");
  const charges = (
    await pool().query(
      `SELECT * FROM client_charge WHERE ${context + "_id"}=$1 ORDER BY created_at`,
      [rid],
    )
  ).rows;
  return {
    ...r,
    charges,
    revisions: (
      await pool().query(
        `SELECT id,reason,created_at FROM cost_revision WHERE ${context + "_id"}=$1 ORDER BY created_at`,
        [rid],
      )
    ).rows,
    ...(context === "expense"
      ? {
          notes: (
            await pool().query(
              "SELECT * FROM note WHERE expense_id=$1 ORDER BY created_at DESC",
              [rid],
            )
          ).rows,
        }
      : {}),
  };
}
async function associations(
  db: PoolClient,
  p: { client_id: string | null; job_id: string | null },
) {
  if (p.client_id)
    requireValue(
      (
        await db.query(
          "SELECT id FROM client WHERE id=$1 AND archived_at IS NULL",
          [p.client_id],
        )
      ).rowCount,
      400,
      "Choose an active client",
    );
  if (p.job_id)
    requireValue(
      (
        await db.query("SELECT id FROM job WHERE id=$1 AND client_id=$2", [
          p.job_id,
          p.client_id,
        ])
      ).rowCount,
      400,
      "Choose a job belonging to this client",
    );
}
async function lockCost(
  db: PoolClient,
  context: "expense" | "trip",
  rid: string,
  version: number | undefined,
  reason: string,
) {
  const current = (
    await db.query(`SELECT * FROM ${context} WHERE id=$1 FOR UPDATE`, [rid])
  ).rows[0];
  requireValue(
    current && !current.archived_at && current.version === version,
    409,
    "Record changed; reload before saving",
  );
  await db.query(
    `SELECT id FROM client_charge WHERE ${context + "_id"}=$1 ORDER BY id FOR UPDATE`,
    [rid],
  );
  requireValue(
    !(
      await db.query(
        `SELECT 1 FROM client_charge c JOIN charge_allocation a ON a.charge_id=c.id WHERE c.${context + "_id"}=$1 AND a.released_at IS NULL`,
        [rid],
      )
    ).rowCount,
    409,
    "Allocated costs are locked. Remove the draft charge or correct the issued invoice first.",
  );
  requireValue(
    reason.trim(),
    400,
    "Explain this historical cost or travel correction",
  );
  return current;
}
async function setCharge(
  db: PoolClient,
  source: "expense" | "trip",
  rid: string,
  kind: "expense" | "mileage" | "travel_time",
  p: { client_id: string | null; job_id: string | null },
  description: string,
  amount: number,
  snapshot: unknown,
  enabled: boolean,
) {
  const old = (
    await db.query(
      `SELECT id FROM client_charge WHERE ${source + "_id"}=$1 AND kind=$2 FOR UPDATE`,
      [rid, kind],
    )
  ).rows[0];
  if (!enabled) {
    if (old)
      await db.query("UPDATE client_charge SET archived_at=now() WHERE id=$1", [
        old.id,
      ]);
    return;
  }
  if (old)
    await db.query(
      "UPDATE client_charge SET client_id=$1,job_id=$2,description=$3,amount_minor=$4,snapshot=$5,archived_at=NULL WHERE id=$6",
      [
        p.client_id,
        p.job_id,
        description,
        amount,
        JSON.stringify(snapshot),
        old.id,
      ],
    );
  else
    await db.query(
      "INSERT INTO client_charge(id,client_id,job_id,expense_id,trip_id,kind,description,amount_minor,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        randomUUID(),
        p.client_id,
        p.job_id,
        source === "expense" ? rid : null,
        source === "trip" ? rid : null,
        kind,
        description,
        amount,
        JSON.stringify(snapshot),
      ],
    );
}
export function tripAmounts(
  p: Pick<
    z.infer<typeof tripInput>,
    | "distance_milli_km"
    | "mileage_rate_minor"
    | "duration_seconds"
    | "rounding_minutes"
    | "time_rate_minor"
  >,
) {
  const billable_seconds = roundSeconds(p.duration_seconds, p.rounding_minutes);
  return {
    mileage_minor: safeMinor(
      divideRound(
        BigInt(p.distance_milli_km) * BigInt(p.mileage_rate_minor),
        1000n,
      ),
    ),
    travel_minor: timeAmounts(billable_seconds, p.time_rate_minor, 0, 0)
      .total_minor,
    billable_seconds,
  };
}
export async function saveExpense(
  p: z.infer<typeof expenseInput>,
  rid: string,
  key?: string,
) {
  const run = async (db: PoolClient) => {
    let previous;
    if (p.version != null)
      previous = await lockCost(db, "expense", rid, p.version, p.change_reason);
    await associations(db, p);
    const fields = [
      p.vendor,
      p.spent_on,
      p.amount_minor,
      p.tax_minor,
      p.category,
      p.description,
      p.payment_method,
      p.client_id,
      p.job_id,
      p.billable,
      p.recovery_minor,
      rid,
    ];
    if (p.version == null)
      await db.query(
        "INSERT INTO expense(vendor,spent_on,amount_minor,tax_minor,category,description,payment_method,client_id,job_id,billable,recovery_minor,id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        fields,
      );
    else
      await db.query(
        "UPDATE expense SET vendor=$1,spent_on=$2,amount_minor=$3,tax_minor=$4,category=$5,description=$6,payment_method=$7,client_id=$8,job_id=$9,billable=$10,recovery_minor=$11,version=version+1,updated_at=now() WHERE id=$12",
        fields,
      );
    await setCharge(
      db,
      "expense",
      rid,
      "expense",
      p,
      p.description || "Expense recovery - " + p.vendor,
      p.recovery_minor,
      {
        vendor: p.vendor,
        spent_on: p.spent_on,
        recovery_minor: p.recovery_minor,
      },
      p.billable,
    );
    if (previous)
      await db.query(
        "INSERT INTO cost_revision(id,expense_id,previous_value,new_value,reason) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), rid, previous, p, p.change_reason],
      );
    return { id: rid };
  };
  return transaction((db) =>
    key ? once(db, key, "expense-create", p, () => run(db)) : run(db),
  );
}
export async function saveTrip(
  p: z.infer<typeof tripInput>,
  rid: string,
  key?: string,
) {
  const run = async (db: PoolClient) => {
    let previous;
    if (p.version != null)
      previous = await lockCost(db, "trip", rid, p.version, p.change_reason);
    await associations(db, p);
    const amounts = tripAmounts(p);
    requireValue(
      amounts.mileage_minor <= 1000000000 && amounts.travel_minor <= 1000000000,
      400,
      "Travel charge exceeds supported invoice unit price",
    );
    const fields = [
      p.travelled_on,
      p.purpose,
      p.origin,
      p.destination,
      p.distance_milli_km,
      p.duration_seconds,
      p.mileage_rate_minor,
      p.time_rate_minor,
      p.rounding_minutes,
      p.client_id,
      p.job_id,
      p.billable_mileage,
      p.billable_time,
      rid,
    ];
    if (p.version == null)
      await db.query(
        "INSERT INTO trip(travelled_on,purpose,origin,destination,distance_milli_km,duration_seconds,mileage_rate_minor,time_rate_minor,rounding_minutes,client_id,job_id,billable_mileage,billable_time,id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        fields,
      );
    else
      await db.query(
        "UPDATE trip SET travelled_on=$1,purpose=$2,origin=$3,destination=$4,distance_milli_km=$5,duration_seconds=$6,mileage_rate_minor=$7,time_rate_minor=$8,rounding_minutes=$9,client_id=$10,job_id=$11,billable_mileage=$12,billable_time=$13,version=version+1,updated_at=now() WHERE id=$14",
        fields,
      );
    await setCharge(
      db,
      "trip",
      rid,
      "mileage",
      p,
      "Mileage - " + p.purpose,
      amounts.mileage_minor,
      { ...p, ...amounts },
      p.billable_mileage,
    );
    await setCharge(
      db,
      "trip",
      rid,
      "travel_time",
      p,
      "Travel time - " + p.purpose,
      amounts.travel_minor,
      { ...p, ...amounts },
      p.billable_time,
    );
    if (previous)
      await db.query(
        "INSERT INTO cost_revision(id,trip_id,previous_value,new_value,reason) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), rid, previous, p, p.change_reason],
      );
    return { id: rid };
  };
  return transaction((db) =>
    key ? once(db, key, "trip-create", p, () => run(db)) : run(db),
  );
}
export async function archiveCost(
  context: "expense" | "trip",
  rid: string,
  version: number,
  reason: string,
) {
  return transaction(async (db) => {
    const previous = await lockCost(db, context, rid, version, reason);
    await db.query(
      `UPDATE client_charge SET archived_at=now() WHERE ${context + "_id"}=$1`,
      [rid],
    );
    await db.query(
      `UPDATE ${context} SET archived_at=now(),version=version+1,updated_at=now() WHERE id=$1`,
      [rid],
    );
    const next = (await db.query(`SELECT * FROM ${context} WHERE id=$1`, [rid]))
      .rows[0];
    await db.query(
      `INSERT INTO cost_revision(id,${context + "_id"},previous_value,new_value,reason) VALUES($1,$2,$3,$4,$5)`,
      [randomUUID(), rid, previous, next, reason],
    );
    return { id: rid };
  });
}
export async function unbilledCharges() {
  return (
    await pool().query(
      "SELECT ch.*,c.name AS client_name FROM client_charge ch JOIN client c ON c.id=ch.client_id WHERE ch.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM charge_allocation a WHERE a.charge_id=ch.id AND a.released_at IS NULL) ORDER BY c.name,ch.created_at",
    )
  ).rows as Charge[];
}
