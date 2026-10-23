import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, transaction } from "@/lib/db";
import { requireValue } from "@/lib/auth";
import { once } from "@/lib/http";
import { id } from "@/lib/validation";
import {
  date,
  lineInput,
  type InvoiceSnapshot,
} from "@/features/billing/model";
import { workLine, invoiceEvent } from "@/features/billing/service";
import { renderInvoicePDF } from "@/features/billing/pdf";
import { safeMinor } from "@/features/billing/money";
export const quoteInput = z
  .object({
    client_id: id,
    contact_id: id.nullable().default(null),
    issue_date: date,
    expiry_date: date,
    paper: z.enum(["A4", "Letter"]).default("Letter"),
    notes: z.string().max(4000).default(""),
    terms: z.string().max(4000).default(""),
    lines: z.array(lineInput.options[0]).min(1).max(200),
  })
  .strict()
  .refine(
    (p) => p.expiry_date >= p.issue_date,
    "Expiry must follow issue date",
  );
export type Quote = {
  id: string;
  client_id: string;
  client_name: string;
  number: string | null;
  state: string;
  status: string;
  issue_date: string;
  expiry_date: string;
  document: InvoiceSnapshot;
  total_minor: string;
  version: number;
  pdf_sha256: string | null;
  decision_note: string;
  predecessor_id: string | null;
  invoice_id: string | null;
  job_id: string | null;
  events: { id: string; type: string; summary: string; created_at: string }[];
};
const projection = `q.id,q.client_id,c.name AS client_name,q.number,q.state,q.issue_date::text,q.expiry_date::text,q.document,q.total_minor,q.version,q.pdf_sha256,q.decision_note,q.predecessor_id,(SELECT id FROM invoice WHERE source_quote_id=q.id AND archived_at IS NULL AND state<>'void') AS invoice_id,(SELECT id FROM job WHERE source_quote_id=q.id) AS job_id,CASE WHEN q.state IN ('published','sent') AND q.expiry_date<(now() AT TIME ZONE b.timezone)::date THEN 'expired' ELSE q.state END AS status`;
export async function listQuotes() {
  return (
    await pool().query(
      `SELECT ${projection} FROM quote q JOIN client c ON c.id=q.client_id CROSS JOIN business_settings b WHERE q.archived_at IS NULL ORDER BY q.created_at DESC`,
    )
  ).rows as Quote[];
}
export async function getQuote(qid: string) {
  const q = (
    await pool().query(
      `SELECT ${projection} FROM quote q JOIN client c ON c.id=q.client_id CROSS JOIN business_settings b WHERE q.id=$1 AND q.archived_at IS NULL`,
      [qid],
    )
  ).rows[0];
  requireValue(q, 404, "Quote not found");
  return {
    ...q,
    events: (
      await pool().query(
        "SELECT * FROM quote_event WHERE quote_id=$1 ORDER BY created_at",
        [qid],
      )
    ).rows,
  } as Quote;
}
export async function quoteEvent(
  db: PoolClient,
  qid: string,
  type: string,
  summary: string,
) {
  await db.query(
    "INSERT INTO quote_event(id,quote_id,type,summary) VALUES($1,$2,$3,$4)",
    [randomUUID(), qid, type, summary],
  );
}
export async function saveQuote(
  db: PoolClient,
  p: z.infer<typeof quoteInput>,
  qid: string,
  version?: number,
) {
  if (version != null) {
    const q = (
      await db.query("SELECT * FROM quote WHERE id=$1 FOR UPDATE", [qid])
    ).rows[0];
    requireValue(
      q && q.state === "draft" && !q.archived_at && q.version === version,
      409,
      "Only an unchanged active draft can be edited",
    );
  }
  const c = (
      await db.query(
        "SELECT * FROM client WHERE id=$1 AND archived_at IS NULL",
        [p.client_id],
      )
    ).rows[0],
    b = (await db.query("SELECT * FROM business_settings")).rows[0];
  requireValue(c, 400, "Choose an active client");
  requireValue(
    b.tax_enabled ||
      p.lines.every(
        (l) =>
          (l.tax_treatment && l.tax_treatment !== "taxable") ||
          (l.tax_bps === 0 &&
            (!l.tax_components ||
              l.tax_components.every((t) => t.rate_milli_percent === 0))),
      ),
    400,
    "Enable taxes before adding tax rates",
  );
  let contact = "";
  if (p.contact_id) {
    const r = (
      await db.query(
        "SELECT name,email FROM client_contact WHERE id=$1 AND client_id=$2",
        [p.contact_id, p.client_id],
      )
    ).rows[0];
    requireValue(r, 400, "Choose a contact belonging to this client");
    contact = r.name + (r.email ? " - " + r.email : "");
  }
  const lines = p.lines.map((l) => workLine(l, new Map()));
  const totals = {
    subtotal_minor: 0,
    discount_minor: 0,
    tax_minor: 0,
    total_minor: 0,
  };
  for (const key of Object.keys(totals) as (keyof typeof totals)[])
    totals[key] = safeMinor(lines.reduce((n, l) => n + BigInt(l[key]), 0n));
  const document: InvoiceSnapshot = {
    format: 1,
    document_kind: "QUOTE",
    number: "DRAFT",
    issue_date: p.issue_date,
    due_date: p.expiry_date,
    paper: p.paper,
    currency: "CAD",
    issuer: {
      name: b.legal_name || b.name,
      address: b.address,
      email: b.email,
      phone: b.phone,
      registration_number: b.registration_number,
    },
    client: {
      name: c.name,
      address: c.billing_address,
      email: c.email,
      phone: c.phone,
      contact,
      ...{ contact_id: p.contact_id },
    },
    accent: b.accent_color,
    payment_instructions: b.payment_instructions,
    notes: p.notes,
    terms: p.terms,
    lines,
    ...totals,
    received_minor: 0,
    balance_minor: totals.total_minor,
  };
  if (version == null)
    await db.query(
      "INSERT INTO quote(id,client_id,issue_date,expiry_date,document,total_minor) VALUES($1,$2,$3,$4,$5,$6)",
      [
        qid,
        p.client_id,
        p.issue_date,
        p.expiry_date,
        JSON.stringify(document),
        totals.total_minor,
      ],
    );
  else
    await db.query(
      "UPDATE quote SET client_id=$1,issue_date=$2,expiry_date=$3,document=$4,total_minor=$5,version=version+1,updated_at=now() WHERE id=$6",
      [
        p.client_id,
        p.issue_date,
        p.expiry_date,
        JSON.stringify(document),
        totals.total_minor,
        qid,
      ],
    );
  await quoteEvent(
    db,
    qid,
    version == null ? "created" : "draft_saved",
    version == null ? "Quote draft created" : "Quote draft revised",
  );
  return { id: qid };
}
export async function publishQuote(qid: string, version: number, key: string) {
  return transaction((db) =>
    once(db, key, "quote-publish", { qid, version }, async () => {
      const q = (
        await db.query("SELECT * FROM quote WHERE id=$1 FOR UPDATE", [qid])
      ).rows[0];
      requireValue(
        q && q.state === "draft" && !q.archived_at && q.version === version,
        409,
        "Reload and review the active draft first",
      );
      const n = (
        await db.query(
          "UPDATE quote_counter SET next_number=next_number+1 WHERE singleton=1 RETURNING next_number-1 AS n",
        )
      ).rows[0].n;
      const number = "QUO-" + String(n).padStart(6, "0"),
        document = { ...q.document, number },
        bytes = await renderInvoicePDF(document);
      await db.query(
        "UPDATE quote SET state='published',number=$1,document=$2,pdf_bytes=$3,pdf_sha256=$4,published_at=now(),version=version+1,updated_at=now() WHERE id=$5",
        [
          number,
          JSON.stringify(document),
          bytes,
          createHash("sha256").update(bytes).digest("hex"),
          qid,
        ],
      );
      await quoteEvent(
        db,
        qid,
        "published",
        "Quote published; agreed document frozen. Not yet emailed.",
      );
      return { id: qid, number };
    }),
  );
}
export async function quotePDF(qid: string) {
  const q = (
    await pool().query(
      "SELECT state,number,document,pdf_bytes FROM quote WHERE id=$1 AND archived_at IS NULL",
      [qid],
    )
  ).rows[0];
  requireValue(q, 404, "Quote not found");
  return {
    bytes: q.pdf_bytes
      ? Buffer.from(q.pdf_bytes)
      : await renderInvoicePDF(q.document),
    number: q.number || "Draft",
  };
}
export async function transitionQuote(
  qid: string,
  version: number,
  state: "accepted" | "declined" | "void",
  reason: string,
) {
  return transaction(async (db) => {
    const q = (
      await db.query(
        "SELECT *,expiry_date>=(now() AT TIME ZONE (SELECT timezone FROM business_settings))::date AS valid FROM quote WHERE id=$1 FOR UPDATE",
        [qid],
      )
    ).rows[0];
    requireValue(
      q &&
        q.version === version &&
        [
          "published",
          "sent",
          ...(state === "void" ? ["accepted"] : []),
        ].includes(q.state),
      409,
      "Quote state changed; reload first",
    );
    requireValue(
      state === "void" || q.valid,
      400,
      "Expired quotes must be revised before acceptance or decline",
    );
    await db.query(
      "UPDATE quote SET state=$1,decision_note=$2,version=version+1,updated_at=now() WHERE id=$3",
      [state, reason, qid],
    );
    await quoteEvent(db, qid, state, reason);
    return { id: qid };
  });
}
export async function reviseQuote(qid: string, key: string) {
  return transaction((db) =>
    once(db, key, "quote-revise", { qid }, async () => {
      const q = (
        await db.query("SELECT * FROM quote WHERE id=$1 FOR UPDATE", [qid])
      ).rows[0];
      requireValue(
        q && q.state !== "draft",
        400,
        "Publish the original quote before revising",
      );
      const next = randomUUID(),
        document = { ...q.document, number: "DRAFT" };
      await db.query(
        "INSERT INTO quote(id,client_id,issue_date,expiry_date,document,total_minor,predecessor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          next,
          q.client_id,
          q.issue_date,
          q.expiry_date,
          JSON.stringify(document),
          q.total_minor,
          qid,
        ],
      );
      await quoteEvent(
        db,
        next,
        "revision_created",
        "Draft revision of " + q.number,
      );
      await quoteEvent(
        db,
        qid,
        "revision_created",
        "A new draft revision was created",
      );
      return { id: next };
    }),
  );
}
export async function convertQuote(
  qid: string,
  target: "job" | "invoice",
  key: string,
) {
  return transaction((db) =>
    once(db, key, "quote-convert", { qid, target }, async () => {
      const q = (
        await db.query("SELECT * FROM quote WHERE id=$1 FOR UPDATE", [qid])
      ).rows[0];
      requireValue(
        q?.state === "accepted",
        409,
        "Explicitly accept the published quote before conversion",
      );
      const table = target === "job" ? "job" : "invoice";
      const prior = (
        await db.query(
          `SELECT id FROM ${table} WHERE source_quote_id=$1 ${target === "invoice" ? "AND archived_at IS NULL AND state<>'void'" : ""} FOR UPDATE`,
          [qid],
        )
      ).rows[0];
      if (prior) return { id: prior.id };
      const cid = (
        await db.query("SELECT archived_at FROM client WHERE id=$1", [
          q.client_id,
        ])
      ).rows[0];
      requireValue(
        cid && !cid.archived_at,
        400,
        "Restore the client before conversion",
      );
      const next = randomUUID(),
        d = q.document as InvoiceSnapshot;
      if (target === "job")
        await db.query(
          "INSERT INTO job(id,client_id,title,description,source_quote_id) VALUES($1,$2,$3,$4,$5)",
          [
            next,
            q.client_id,
            "Work from " + q.number,
            d.lines
              .map(
                (l) =>
                  `${l.description}: ${l.quantity} × ${l.unit_minor} CAD cents`,
              )
              .join("\n") +
              "\n\n" +
              d.notes,
            qid,
          ],
        );
      else {
        const dates = (
          await db.query(
            "SELECT (now() AT TIME ZONE timezone)::date::text AS today,((now() AT TIME ZONE timezone)::date+30)::text AS due FROM business_settings",
          )
        ).rows[0];
        await db.query(
          "INSERT INTO invoice(id,client_id,source_quote_id,issue_date,due_date,paper,issuer_snapshot,client_snapshot,notes,terms,subtotal_minor,discount_minor,tax_minor,total_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
          [
            next,
            q.client_id,
            qid,
            dates.today,
            dates.due,
            d.paper,
            {
              ...d.issuer,
              accent: d.accent,
              payment_instructions: d.payment_instructions,
            },
            d.client,
            d.notes,
            d.terms,
            d.subtotal_minor,
            d.discount_minor,
            d.tax_minor,
            d.total_minor,
          ],
        );
        for (const [position, l] of d.lines.entries())
          await db.query(
            "INSERT INTO invoice_line(id,invoice_id,position,kind,description,quantity,unit_minor,discount_bps,tax_bps,tax_label,subtotal_minor,discount_minor,tax_minor,total_minor,source_snapshot,tax_snapshot,tax_treatment) VALUES($1,$2,$3,'manual',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'[]',$14,$15)",
            [
              randomUUID(),
              next,
              position,
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
              JSON.stringify(l.tax_snapshot || []),
              l.tax_treatment || "taxable",
            ],
          );
        await invoiceEvent(
          db,
          next,
          "quote_converted",
          "Agreed prices and taxes copied from " +
            q.number +
            "; compare any draft changes with the accepted quote",
        );
      }
      await quoteEvent(
        db,
        qid,
        target + "_created",
        "Accepted snapshot converted to " + target,
      );
      return { id: next };
    }),
  );
}
