import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "@/lib/db";
import { requireValue } from "@/lib/auth";
import { json, read, once, requestId } from "@/lib/http";
import { id, text } from "@/lib/validation";
import { date } from "./model";
import { invoiceEvent } from "./service";
export async function adjustmentRoutes(req: Request, path: string[]) {
  if (path[0] !== "invoices" || path[2] !== "adjustments") return;
  const invoiceId = id.parse(path[1]);
  if (path.length === 3 && req.method === "GET")
    return json(
      (
        await pool().query(
          "SELECT *,occurred_on::text FROM invoice_adjustment WHERE invoice_id=$1 ORDER BY created_at",
          [invoiceId],
        )
      ).rows,
    );
  if (req.method !== "POST") return;
  const reversal = path.length === 5 && path[4] === "reverse";
  if (path.length !== 3 && !reversal) return;
  const raw = await read(req);
  const creation = reversal
    ? null
    : z
        .object({
          kind: z.enum(["credit", "refund"]),
          amount_minor: z.number().int().min(1).max(100000000000000),
          tax_minor: z.number().int().min(0).max(100000000000000).default(0),
          occurred_on: date,
          reason: text(1000),
          method: z
            .enum(["e_transfer", "cash", "cheque", "other"])
            .default("other"),
          reference: z.string().max(160).default(""),
        })
        .strict()
        .parse(raw);
  const p =
    creation ||
    z
      .object({ reason: text(1000) })
      .strict()
      .parse(raw);
  return json(
    await transaction((db) =>
      once(
        db,
        requestId(req),
        "invoice-adjustment",
        { invoiceId, ...p, reverses_id: reversal ? id.parse(path[3]) : null },
        async () => {
          const parent = (
            await db.query("SELECT state FROM invoice WHERE id=$1 FOR UPDATE", [
              invoiceId,
            ])
          ).rows[0];
          requireValue(
            parent?.state === "issued",
            409,
            "Only issued invoices accept credits or refunds",
          );
          const aid = randomUUID();
          if (reversal) {
            const original = (
              await db.query(
                "SELECT * FROM invoice_adjustment WHERE id=$1 AND invoice_id=$2 AND kind IN ('credit','refund')",
                [id.parse(path[3]), invoiceId],
              )
            ).rows[0];
            requireValue(original, 404, "Original event not found");
            await db.query(
              "INSERT INTO invoice_adjustment(id,invoice_id,kind,amount_minor,occurred_on,reason,method,reverses_id,tax_minor) VALUES($1,$2,$3,$4,(now() AT TIME ZONE (SELECT timezone FROM business_settings))::date,$5,$6,$7,$8)",
              [
                aid,
                invoiceId,
                original.kind + "_reversal",
                original.amount_minor,
                p.reason,
                original.method,
                original.id,
                original.tax_minor,
              ],
            );
          } else {
            requireValue(creation, 400, "Missing adjustment");
            await db.query(
              "INSERT INTO invoice_adjustment(id,invoice_id,kind,amount_minor,occurred_on,reason,method,reference,tax_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
              [
                aid,
                invoiceId,
                creation.kind,
                creation.amount_minor,
                creation.occurred_on,
                creation.reason,
                creation.method,
                creation.reference,
                creation.tax_minor,
              ],
            );
          }
          await invoiceEvent(
            db,
            invoiceId,
            reversal ? "adjustment_reversed" : creation!.kind,
            p.reason,
          );
          return { id: aid };
        },
      ),
    ),
    201,
  );
}
