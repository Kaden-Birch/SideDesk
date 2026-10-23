import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "@/lib/db";
import { json, read, once, requestId } from "@/lib/http";
import { id, rate, text } from "@/lib/validation";
import { draftInput, billingProfile, date } from "./model";
import { requireValue } from "@/lib/auth";
import * as s from "./service";
export async function billingRoutes(
  req: Request,
  path: string[],
): Promise<Response | undefined> {
  const route = path.join("/"),
    method = req.method;
  if (route === "billing-profile" && method === "PUT") {
    const p = billingProfile.parse(await read(req));
    const r = await transaction((db) =>
      db.query(
        "UPDATE business_settings SET legal_name=$1,address=$2,email=$3,phone=$4,registration_number=$5,payment_instructions=$6,invoice_terms=$7,rounding_scope=$8,accent_color=$9,version=version+1,updated_at=now() WHERE version=$10 RETURNING *",
        [
          p.legal_name,
          p.address,
          p.email,
          p.phone,
          p.registration_number,
          p.payment_instructions,
          p.invoice_terms,
          p.rounding_scope,
          p.accent_color,
          p.version,
        ],
      ),
    );
    requireValue(r.rowCount, 409, "Settings changed. Refresh before saving.");
    return json(r.rows[0]);
  }
  if (route === "payments" && method === "GET")
    return json(
      (
        await pool().query(
          "SELECT p.*,p.received_on::text,i.number,c.name AS client_name FROM payment p JOIN invoice i ON i.id=p.invoice_id JOIN client c ON c.id=i.client_id ORDER BY p.created_at DESC",
        )
      ).rows,
    );
  if (route === "billing-summary" && method === "GET") {
    const r = (
      await pool().query(`SELECT
 (SELECT COALESCE(sum(CASE WHEN p.kind='receipt' THEN p.amount_minor ELSE -p.amount_minor END),0) FROM payment p WHERE p.received_on>=date_trunc('month',now() AT TIME ZONE b.timezone)::date AND p.received_on<(date_trunc('month',now() AT TIME ZONE b.timezone)+interval '1 month')::date)
 -(SELECT COALESCE(sum(CASE WHEN a.kind='refund' THEN a.amount_minor ELSE -a.amount_minor END),0) FROM invoice_adjustment a WHERE a.kind IN ('refund','refund_reversal') AND a.occurred_on>=date_trunc('month',now() AT TIME ZONE b.timezone)::date AND a.occurred_on<(date_trunc('month',now() AT TIME ZONE b.timezone)+interval '1 month')::date) AS received_month_minor,
 (SELECT COALESCE(sum(f.balance_minor),0) FROM invoice_financials f JOIN invoice i ON i.id=f.id WHERE i.state='issued') AS outstanding_minor,
 (SELECT COALESCE(sum(f.customer_credit_minor),0) FROM invoice_financials f JOIN invoice i ON i.id=f.id WHERE i.state='issued') AS customer_credit_minor,
 (SELECT COALESCE(sum(t.duration_seconds),0) FROM time_entry t WHERE billable AND NOT EXISTS(SELECT 1 FROM invoice_allocation x WHERE x.time_entry_id=t.id AND x.released_at IS NULL)) AS unbilled_seconds FROM business_settings b`)
    ).rows[0];
    return json(
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k,
          k.endsWith("_minor") && !Number.isSafeInteger(Number(v))
            ? String(v)
            : Number(v),
        ]),
      ),
    );
  }
  if (route === "unbilled" && method === "GET") return json(await s.unbilled());
  if (path[0] === "time-entries" && path.length === 2 && method === "PUT") {
    const p = z
      .object({
        version: z.number().int().positive(),
        rate_minor: rate,
        billable: z.boolean(),
        reason: text(500),
      })
      .strict()
      .parse(await read(req));
    return json(await s.reviewTime(id.parse(path[1]), p));
  }
  if (route === "invoices" && method === "GET")
    return json(await s.listInvoices());
  if (route === "invoices" && method === "POST") {
    const p = draftInput.parse(await read(req));
    return json(
      await transaction((db) =>
        once(db, requestId(req), "invoice-create", p, () =>
          s.saveDraft(db, p, randomUUID()),
        ),
      ),
      201,
    );
  }
  if (route === "invoices/from-charges" && method === "POST") {
    const p = z
      .object({ client_id: id, charge_ids: z.array(id).min(1).max(200) })
      .strict()
      .parse(await read(req));
    return json(
      await s.fromCharges(p.client_id, p.charge_ids, requestId(req)),
      201,
    );
  }
  if (route === "invoices/from-time" && method === "POST") {
    const p = z
      .object({ client_id: id, source_ids: z.array(id).min(1).max(250) })
      .strict()
      .parse(await read(req));
    return json(
      await s.fromTime(p.client_id, p.source_ids, requestId(req)),
      201,
    );
  }
  if (path[0] !== "invoices" || path.length < 2) return;
  const iid = id.parse(path[1]);
  if (path.length === 2) {
    if (method === "GET") return json(await s.getInvoice(iid));
    if (method === "PUT") {
      const body = await read(req);
      const version = z
        .object({ version: z.number().int().positive() })
        .parse(body).version;
      const { version: _, ...fields } = body;
      void _;
      const p = draftInput.parse(fields);
      return json(await transaction((db) => s.saveDraft(db, p, iid, version)));
    }
    if (method === "DELETE") {
      const p = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(await read(req));
      return json(await s.archiveDraft(iid, p.version));
    }
  }
  if (path[2] === "pdf" && path.length === 3 && method === "GET") {
    const pdf = await s.invoicePDF(iid);
    return new Response(new Uint8Array(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${new URL(req.url).searchParams.get("preview") === "1" ? "inline" : "attachment"}; filename="Invoice-${pdf.number.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (path[2] === "issue" && path.length === 3 && method === "POST") {
    const p = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(await read(req));
    return json(await s.issueInvoice(iid, p.version, requestId(req)));
  }
  if (path[2] === "void" && path.length === 3 && method === "POST") {
    const p = z
      .object({ version: z.number().int().positive(), reason: text(500) })
      .strict()
      .parse(await read(req));
    return json(await s.voidInvoice(iid, p.version, p.reason));
  }
  if (path[2] === "payments" && path.length === 3 && method === "POST") {
    const p = z
      .object({
        amount_minor: z.number().int().min(1).max(100000000000000),
        method: z.enum(["e_transfer", "cash", "cheque", "other"]),
        received_on: date,
        reference: z.string().max(160).default(""),
        note: z.string().max(1000).default(""),
      })
      .strict()
      .parse(await read(req));
    return json(await s.recordPayment(iid, p, requestId(req)), 201);
  }
  if (
    path[2] === "payments" &&
    path.length === 5 &&
    path[4] === "reverse" &&
    method === "POST"
  ) {
    const p = z
      .object({ reason: text(500) })
      .strict()
      .parse(await read(req));
    return json(
      await s.reversePayment(iid, id.parse(path[3]), p.reason, requestId(req)),
      201,
    );
  }
}
