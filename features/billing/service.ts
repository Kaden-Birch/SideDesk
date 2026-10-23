import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, transaction } from "@/lib/db";
import { requireValue } from "@/lib/auth";
import { once } from "@/lib/http";
import { manualAmounts, timeAmounts, roundSeconds, safeMinor } from "./money";
import type {
  DraftInput,
  InvoiceSnapshot,
  Line,
  Party,
  Source,
  Invoice,
} from "./model";
import { renderInvoicePDF } from "./pdf";
export async function invoiceEvent(
  db: PoolClient,
  invoiceId: string,
  type: string,
  summary: string,
) {
  await db.query(
    "INSERT INTO invoice_event(id,invoice_id,type,summary) VALUES($1,$2,$3,$4)",
    [randomUUID(), invoiceId, type, summary],
  );
}
const sourceQuery = `SELECT t.*,a.client_id,a.title,j.title AS job_title FROM time_entry t JOIN activity a ON a.id=t.activity_id LEFT JOIN job j ON j.id=t.job_id`;
export async function unbilled() {
  return (
    await pool().query(
      sourceQuery +
        ` WHERE t.billable AND NOT EXISTS(SELECT 1 FROM invoice_allocation x WHERE x.time_entry_id=t.id AND x.released_at IS NULL) ORDER BY a.client_id,t.created_at`,
    )
  ).rows as Source[];
}
const numericFields = [
  "subtotal_minor",
  "discount_minor",
  "tax_minor",
  "total_minor",
  "received_minor",
  "balance_minor",
  "unit_minor",
];
function numbers<T>(row: T): T {
  const r = row as Record<string, unknown>;
  for (const field of numericFields)
    if (r[field] != null) r[field] = Number(r[field]);
  return row;
}
export function invoiceState(
  i: {
    state: string;
    balance_minor: number;
    received_minor: number;
    due_date: string;
  },
  today: string,
) {
  if (i.state !== "issued") return i.state;
  if (i.balance_minor === 0) return "paid";
  if (i.due_date < today) return "overdue";
  return i.received_minor > 0 ? "partially_paid" : "issued";
}
export async function listInvoices() {
  const { rows } = await pool()
    .query(`SELECT i.id,i.client_id,c.name AS client_name,i.state,i.number,i.issue_date::text,i.due_date::text,i.currency,i.total_minor,i.version,i.created_at,
 COALESCE(p.net,0) AS received_minor,i.total_minor-COALESCE(p.net,0) AS balance_minor,
 (now() AT TIME ZONE b.timezone)::date::text AS today FROM invoice i JOIN client c ON c.id=i.client_id CROSS JOIN business_settings b LEFT JOIN LATERAL(SELECT sum(CASE WHEN kind='receipt' THEN amount_minor ELSE -amount_minor END) AS net FROM payment WHERE invoice_id=i.id)p ON true WHERE i.archived_at IS NULL ORDER BY i.created_at DESC`);
  return rows.map((r) => {
    numbers(r);
    return { ...r, status: invoiceState(r, r.today) };
  });
}
export async function getInvoice(id: string) {
  const { rows } = await pool().query(
    `SELECT i.id,i.client_id,c.name AS client_name,i.state,i.number,i.issue_date::text,i.due_date::text,i.paper,i.currency,i.issuer_snapshot,i.client_snapshot,i.notes,i.terms,i.subtotal_minor,i.discount_minor,i.tax_minor,i.total_minor,i.version,i.pdf_sha256,i.void_reason,
 COALESCE(p.net,0) AS received_minor,i.total_minor-COALESCE(p.net,0) AS balance_minor,(now() AT TIME ZONE b.timezone)::date::text AS today
 FROM invoice i JOIN client c ON c.id=i.client_id CROSS JOIN business_settings b LEFT JOIN LATERAL(SELECT sum(CASE WHEN kind='receipt' THEN amount_minor ELSE -amount_minor END) AS net FROM payment WHERE invoice_id=i.id)p ON true WHERE i.id=$1 AND i.archived_at IS NULL`,
    [id],
  );
  requireValue(rows[0], 404, "Invoice not found");
  const i = numbers(rows[0]);
  const [lines, payments, events] = await Promise.all([
    pool().query(
      "SELECT * FROM invoice_line WHERE invoice_id=$1 ORDER BY position",
      [id],
    ),
    pool().query(
      "SELECT *,received_on::text FROM payment WHERE invoice_id=$1 ORDER BY created_at",
      [id],
    ),
    pool().query(
      "SELECT * FROM invoice_event WHERE invoice_id=$1 ORDER BY created_at",
      [id],
    ),
  ]);
  return {
    ...i,
    status: invoiceState(i, i.today),
    lines: lines.rows.map(numbers),
    payments: payments.rows,
    events: events.rows,
  } as Invoice;
}
async function lockSources(
  db: PoolClient,
  ids: string[],
  clientId: string,
  invoiceId: string,
) {
  requireValue(
    new Set(ids).size === ids.length,
    400,
    "A time entry can appear only once on an invoice",
  );
  if (!ids.length) return new Map<string, Source>();
  const { rows } = await db.query(
    sourceQuery + " WHERE t.id=ANY($1::uuid[]) ORDER BY t.id FOR UPDATE OF t",
    [ids],
  );
  requireValue(rows.length === ids.length, 400, "Time entry not found");
  for (const s of rows) {
    requireValue(
      s.client_id === clientId && s.billable,
      400,
      "All source entries must be billable and belong to this client",
    );
    const allocation = await db.query(
      "SELECT id FROM invoice_allocation WHERE time_entry_id=$1 AND invoice_id<>$2 AND released_at IS NULL",
      [s.id, invoiceId],
    );
    requireValue(
      !allocation.rowCount,
      409,
      "A source is already reserved or billed by another invoice",
    );
  }
  return new Map(rows.map((r) => [r.id, r as Source]));
}
function workLine(
  input: DraftInput["lines"][number],
  sources: Map<string, Source>,
): Line {
  const common = {
    id: randomUUID(),
    kind: input.kind,
    description: input.description,
    discount_bps: input.discount_bps,
    tax_bps: input.tax_bps,
    tax_label: input.tax_label || "Tax",
  };
  if (input.kind === "manual")
    return {
      ...common,
      quantity: input.quantity,
      unit_minor: input.unit_minor,
      ...manualAmounts(
        input.quantity,
        input.unit_minor,
        input.discount_bps,
        input.tax_bps,
      ),
      original_seconds: null,
      billable_seconds: null,
      source_snapshot: [],
    };
  const entries = input.source_ids.map((id) => sources.get(id)!);
  const first = entries[0];
  requireValue(
    entries.every(
      (e) =>
        e.rate_minor === first.rate_minor &&
        e.rounding_minutes === first.rounding_minutes &&
        e.rounding_scope === first.rounding_scope &&
        e.job_id === first.job_id,
    ),
    400,
    "Group time only when its rate, rounding policy and historical job match",
  );
  const original = entries.reduce((n, e) => n + e.duration_seconds, 0),
    billed =
      first.rounding_scope === "group"
        ? roundSeconds(original, first.rounding_minutes)
        : entries.reduce(
            (n, e) => n + roundSeconds(e.duration_seconds, e.rounding_minutes),
            0,
          );
  requireValue(
    billed <= 2147483647,
    400,
    "Time grouping exceeds supported duration",
  );
  return {
    ...common,
    quantity: (billed / 3600).toFixed(6),
    unit_minor: Number(first.rate_minor),
    ...timeAmounts(
      billed,
      Number(first.rate_minor),
      input.discount_bps,
      input.tax_bps,
    ),
    original_seconds: original,
    billable_seconds: billed,
    source_snapshot: entries,
  };
}
export async function saveDraft(
  db: PoolClient,
  input: DraftInput,
  id: string,
  version?: number,
) {
  if (version != null) {
    const current = (
      await db.query(
        "SELECT state,version,archived_at FROM invoice WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    requireValue(current, 404, "Invoice not found");
    requireValue(
      current.state === "draft" && !current.archived_at,
      409,
      "Only active drafts are editable",
    );
    requireValue(
      current.version === version,
      409,
      "Draft changed in another tab. Reload before saving.",
    );
  }
  const c = (
    await db.query(
      "SELECT id,name,billing_address,email,phone,archived_at FROM client WHERE id=$1",
      [input.client_id],
    )
  ).rows[0];
  requireValue(c && !c.archived_at, 400, "Choose an active client");
  const b = (await db.query("SELECT * FROM business_settings")).rows[0];
  requireValue(
    b.tax_enabled || input.lines.every((l) => l.tax_bps === 0),
    400,
    "Enable taxes in Settings before adding a tax rate",
  );
  let contact = "";
  if (input.contact_id) {
    const r = await db.query(
      "SELECT name,email FROM client_contact WHERE id=$1 AND client_id=$2",
      [input.contact_id, input.client_id],
    );
    requireValue(
      r.rowCount,
      400,
      "Billing contact does not belong to this client",
    );
    contact = r.rows[0].name + (r.rows[0].email ? " - " + r.rows[0].email : "");
  }
  const sourceIds = input.lines.flatMap((l) =>
      l.kind === "time" ? l.source_ids : [],
    ),
    sources = await lockSources(db, sourceIds, input.client_id, id),
    lines = input.lines.map((l) => workLine(l, sources));
  const totals = {
    subtotal_minor: 0,
    discount_minor: 0,
    tax_minor: 0,
    total_minor: 0,
  };
  for (const f of Object.keys(totals) as (keyof typeof totals)[])
    totals[f] = safeMinor(lines.reduce((n, l) => n + BigInt(l[f]), 0n));
  const issuer = {
    name: b.legal_name || b.name,
    address: b.address,
    email: b.email,
    phone: b.phone,
    registration_number: b.registration_number,
    accent: b.accent_color,
    payment_instructions: b.payment_instructions,
  };
  const client = {
    name: c.name,
    address: c.billing_address,
    email: c.email,
    phone: c.phone,
    contact,
    contact_id: input.contact_id,
  };
  if (version == null)
    await db.query(
      "INSERT INTO invoice(id,client_id,issue_date,due_date,paper,issuer_snapshot,client_snapshot,notes,terms,subtotal_minor,discount_minor,tax_minor,total_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        id,
        input.client_id,
        input.issue_date,
        input.due_date,
        input.paper,
        issuer,
        client,
        input.notes,
        input.terms,
        totals.subtotal_minor,
        totals.discount_minor,
        totals.tax_minor,
        totals.total_minor,
      ],
    );
  else {
    await db.query("DELETE FROM invoice_allocation WHERE invoice_id=$1", [id]);
    await db.query("DELETE FROM invoice_line WHERE invoice_id=$1", [id]);
    await db.query(
      "UPDATE invoice SET client_id=$1,issue_date=$2,due_date=$3,paper=$4,issuer_snapshot=$5,client_snapshot=$6,notes=$7,terms=$8,subtotal_minor=$9,discount_minor=$10,tax_minor=$11,total_minor=$12,version=version+1,updated_at=now() WHERE id=$13",
      [
        input.client_id,
        input.issue_date,
        input.due_date,
        input.paper,
        issuer,
        client,
        input.notes,
        input.terms,
        totals.subtotal_minor,
        totals.discount_minor,
        totals.tax_minor,
        totals.total_minor,
        id,
      ],
    );
  }
  for (const [position, l] of lines.entries()) {
    await db.query(
      "INSERT INTO invoice_line(id,invoice_id,position,kind,description,quantity,unit_minor,discount_bps,tax_bps,tax_label,subtotal_minor,discount_minor,tax_minor,total_minor,original_seconds,billable_seconds,source_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
      [
        l.id,
        id,
        position,
        l.kind,
        l.description,
        l.quantity,
        l.unit_minor,
        l.discount_bps,
        l.tax_bps,
        l.tax_label,
        l.subtotal_minor,
        l.discount_minor,
        l.tax_minor,
        l.total_minor,
        l.original_seconds,
        l.billable_seconds,
        JSON.stringify(l.source_snapshot),
      ],
    );
    for (const s of l.source_snapshot)
      await db.query(
        "INSERT INTO invoice_allocation(id,invoice_id,line_id,time_entry_id,allocated_seconds) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), id, l.id, s.id, s.duration_seconds],
      );
  }
  await invoiceEvent(
    db,
    id,
    version == null ? "created" : "draft_saved",
    version == null ? "Draft created" : "Draft revised",
  );
  return { id };
}
export async function fromTime(clientId: string, ids: string[], key: string) {
  return transaction((db) =>
    once(db, key, "invoice-from-time", { clientId, ids }, async () => {
      const id = randomUUID(),
        sources = await lockSources(db, ids, clientId, id);
      requireValue(ids.length > 0, 400, "Choose stopped time entries");
      const groups = new Map<string, Source[]>();
      for (const s of sources.values()) {
        const k = JSON.stringify([
          s.job_id,
          s.rate_minor,
          s.rounding_minutes,
          s.rounding_scope,
        ]);
        groups.set(k, [...(groups.get(k) || []), s]);
      }
      const b = (
        await db.query(
          "SELECT invoice_terms,(now() AT TIME ZONE timezone)::date::text AS today,((now() AT TIME ZONE timezone)::date+30)::text AS due FROM business_settings",
        )
      ).rows[0];
      return saveDraft(
        db,
        {
          client_id: clientId,
          contact_id: null,
          issue_date: b.today,
          due_date: b.due,
          paper: "Letter",
          notes: "",
          terms: b.invoice_terms,
          lines: [...groups.values()].map((g) => ({
            kind: "time",
            description:
              g[0].job_title ||
              (g.length === 1
                ? g[0].title
                : `Client work - ${g.length} time entries`),
            source_ids: g.map((s) => s.id),
            discount_bps: 0,
            tax_bps: 0,
            tax_label: "Tax",
          })),
        },
        id,
      );
    }),
  );
}
export function toSnapshot(
  i: Pick<
    Invoice,
    | "issuer_snapshot"
    | "client_snapshot"
    | "issue_date"
    | "due_date"
    | "paper"
    | "notes"
    | "terms"
    | "lines"
    | "subtotal_minor"
    | "discount_minor"
    | "tax_minor"
    | "total_minor"
  >,
  number: string,
): InvoiceSnapshot {
  return {
    format: 1,
    number,
    issue_date: i.issue_date,
    due_date: i.due_date,
    currency: "CAD",
    paper: i.paper,
    issuer: i.issuer_snapshot as Party,
    client: i.client_snapshot,
    accent: i.issuer_snapshot.accent,
    payment_instructions: i.issuer_snapshot.payment_instructions,
    notes: i.notes,
    terms: i.terms,
    lines: i.lines,
    subtotal_minor: i.subtotal_minor,
    discount_minor: i.discount_minor,
    tax_minor: i.tax_minor,
    total_minor: i.total_minor,
    received_minor: 0,
    balance_minor: i.total_minor,
  };
}
export async function issueInvoice(id: string, version: number, key: string) {
  return transaction((db) =>
    once(db, key, "invoice-issue", { id, version }, async () => {
      const i = (
        await db.query(
          "SELECT *,issue_date::text,due_date::text FROM invoice WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      requireValue(
        i && i.state === "draft" && !i.archived_at,
        409,
        "Only an active draft can be issued",
      );
      requireValue(
        i.version === version,
        409,
        "Draft changed. Reload and review it first",
      );
      const rows = (
        await db.query(
          "SELECT * FROM invoice_line WHERE invoice_id=$1 ORDER BY position",
          [id],
        )
      ).rows;
      requireValue(rows.length > 0, 400, "An invoice needs at least one line");
      // Lock numbering for the short, bounded rendering transaction. A renderer failure rolls everything back.
      const counter = (
        await db.query(
          "UPDATE invoice_counter SET next_number=next_number+1 WHERE singleton=1 RETURNING next_number-1 AS n",
        )
      ).rows[0].n;
      const prefix = (
        await db.query("SELECT invoice_prefix FROM business_settings")
      ).rows[0].invoice_prefix;
      const number = prefix + String(counter).padStart(6, "0"),
        snapshot = toSnapshot(
          { ...numbers(i), lines: rows.map(numbers) },
          number,
        );
      const pdf = await renderInvoicePDF(snapshot);
      requireValue(pdf.length <= 10000000, 400, "PDF exceeds supported size");
      const sha = createHash("sha256").update(pdf).digest("hex");
      await db.query(
        "UPDATE invoice SET state='issued',number=$1,sequence_number=$2,snapshot=$3,pdf_bytes=$4,pdf_sha256=$5,issued_at=now(),version=version+1,updated_at=now() WHERE id=$6",
        [number, counter, JSON.stringify(snapshot), pdf, sha, id],
      );
      await invoiceEvent(db, id, "issued", `Issued ${number}`);
      return { id, number };
    }),
  );
}
export async function invoicePDF(id: string) {
  const r = (
    await pool().query(
      "SELECT state,number,pdf_bytes FROM invoice WHERE id=$1 AND archived_at IS NULL",
      [id],
    )
  ).rows[0];
  requireValue(r, 404, "Invoice not found");
  if (r.state !== "draft")
    return { bytes: r.pdf_bytes as Buffer, number: r.number as string };
  const i = await getInvoice(id);
  return {
    bytes: await renderInvoicePDF(toSnapshot(i, "DRAFT")),
    number: "Draft",
  };
}
export async function recordPayment(
  id: string,
  p: {
    amount_minor: number;
    method: string;
    received_on: string;
    reference: string;
    note: string;
  },
  key: string,
) {
  return transaction((db) =>
    once(db, key, "payment", { id, ...p }, async () => {
      const i = (
        await db.query(
          "SELECT state,total_minor FROM invoice WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      requireValue(
        i?.state === "issued",
        409,
        "Only issued invoices accept payments",
      );
      const net = Number(
        (
          await db.query(
            "SELECT COALESCE(sum(CASE WHEN kind='receipt' THEN amount_minor ELSE -amount_minor END),0) AS net FROM payment WHERE invoice_id=$1",
            [id],
          )
        ).rows[0].net,
      );
      requireValue(
        p.amount_minor <= Number(i.total_minor) - net,
        400,
        "Payment exceeds outstanding balance",
      );
      const paymentId = randomUUID();
      await db.query(
        "INSERT INTO payment(id,invoice_id,kind,amount_minor,method,received_on,reference,note) VALUES($1,$2,'receipt',$3,$4,$5,$6,$7)",
        [
          paymentId,
          id,
          p.amount_minor,
          p.method,
          p.received_on,
          p.reference,
          p.note,
        ],
      );
      await invoiceEvent(db, id, "payment", "Receipt recorded");
      return { id: paymentId };
    }),
  );
}
export async function reversePayment(
  id: string,
  paymentId: string,
  reason: string,
  key: string,
) {
  return transaction((db) =>
    once(db, key, "payment-reversal", { id, paymentId, reason }, async () => {
      const i = (
        await db.query("SELECT state FROM invoice WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      requireValue(i?.state === "issued", 409, "Invoice is not issued");
      const p = (
        await db.query(
          "SELECT * FROM payment WHERE id=$1 AND invoice_id=$2 AND kind='receipt'",
          [paymentId, id],
        )
      ).rows[0];
      requireValue(p, 404, "Receipt not found");
      requireValue(
        !(
          await db.query("SELECT id FROM payment WHERE reverses_id=$1", [
            paymentId,
          ])
        ).rowCount,
        409,
        "Receipt already reversed",
      );
      const reversalId = randomUUID();
      await db.query(
        "INSERT INTO payment(id,invoice_id,kind,amount_minor,method,received_on,note,reverses_id) VALUES($1,$2,'reversal',$3,$4,(now() AT TIME ZONE (SELECT timezone FROM business_settings))::date,$5,$6)",
        [reversalId, id, p.amount_minor, p.method, reason, p.id],
      );
      await invoiceEvent(
        db,
        id,
        "receipt_reversed",
        "Receipt corrected with an append-only reversal",
      );
      return { id: reversalId };
    }),
  );
}
export async function voidInvoice(id: string, version: number, reason: string) {
  return transaction(async (db) => {
    const i = (
      await db.query(
        "SELECT state,version FROM invoice WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    requireValue(
      i?.state === "issued" && i.version === version,
      409,
      "Reload the issued invoice before voiding",
    );
    const net = Number(
      (
        await db.query(
          "SELECT COALESCE(sum(CASE WHEN kind='receipt' THEN amount_minor ELSE -amount_minor END),0) AS net FROM payment WHERE invoice_id=$1",
          [id],
        )
      ).rows[0].net,
    );
    requireValue(
      net === 0,
      400,
      "Reverse receipts before voiding this invoice",
    );
    await db.query(
      "UPDATE invoice SET state='void',voided_at=now(),void_reason=$1,version=version+1,updated_at=now() WHERE id=$2",
      [reason, id],
    );
    await invoiceEvent(db, id, "voided", reason);
    return { id };
  });
}
export async function archiveDraft(id: string, version: number) {
  return transaction(async (db) => {
    const i = (
      await db.query(
        "SELECT state,version FROM invoice WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    requireValue(
      i?.state === "draft" && i.version === version,
      409,
      "Only an unchanged draft can be discarded",
    );
    await db.query("DELETE FROM invoice_allocation WHERE invoice_id=$1", [id]);
    await db.query(
      "UPDATE invoice SET archived_at=now(),version=version+1 WHERE id=$1",
      [id],
    );
    await invoiceEvent(
      db,
      id,
      "discarded",
      "Draft discarded; source reservations released",
    );
    return { id };
  });
}
export async function reviewTime(
  id: string,
  p: { version: number; rate_minor: number; billable: boolean; reason: string },
) {
  return transaction(async (db) => {
    const t = (
      await db.query("SELECT * FROM time_entry WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    requireValue(
      t && t.version === p.version,
      409,
      "Time entry changed. Reload it first",
    );
    requireValue(
      !(
        await db.query(
          "SELECT id FROM invoice_allocation WHERE time_entry_id=$1 AND released_at IS NULL",
          [id],
        )
      ).rowCount,
      409,
      "Remove this entry from its draft, or void its invoice, before changing billing",
    );
    const next = {
      rate_minor: String(p.rate_minor),
      billable: p.billable,
      rate_source: "entry",
    };
    await db.query(
      "UPDATE time_entry SET rate_minor=$1,billable=$2,rate_source='entry',version=version+1 WHERE id=$3",
      [p.rate_minor, p.billable, id],
    );
    await db.query(
      "INSERT INTO time_entry_revision(id,time_entry_id,previous_value,new_value,reason) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        id,
        {
          rate_minor: t.rate_minor,
          billable: t.billable,
          rate_source: t.rate_source,
        },
        next,
        p.reason,
      ],
    );
    return { id };
  });
}
