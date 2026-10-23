import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "@/lib/db";
import { requireValue } from "@/lib/auth";
import { json, read, once, requestId } from "@/lib/http";
import { id, text } from "@/lib/validation";
import * as s from "./service";
export async function quoteRoutes(req: Request, path: string[]) {
  if (path[0] !== "quotes") return;
  if (path.length === 1 && req.method === "GET")
    return json(await s.listQuotes());
  if (path.length === 1 && req.method === "POST") {
    const p = s.quoteInput.parse(await read(req));
    return json(
      await transaction((db) =>
        once(db, requestId(req), "quote-create", p, () =>
          s.saveQuote(db, p, randomUUID()),
        ),
      ),
      201,
    );
  }
  if (path.length < 2) return;
  const qid = id.parse(path[1]);
  if (path.length === 2 && req.method === "GET")
    return json(await s.getQuote(qid));
  if (path.length === 2 && req.method === "PUT") {
    const { version, ...fields } = await read(req);
    const v = z.number().int().positive().parse(version),
      p = s.quoteInput.parse(fields);
    return json(await transaction((db) => s.saveQuote(db, p, qid, v)));
  }
  if (path.length === 2 && req.method === "DELETE") {
    const p = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(await read(req));
    return json(
      await transaction(async (db) => {
        const r = await db.query(
          "UPDATE quote SET archived_at=now(),version=version+1,updated_at=now() WHERE id=$1 AND state='draft' AND version=$2 AND archived_at IS NULL RETURNING id",
          [qid, p.version],
        );
        requireValue(
          r.rowCount,
          409,
          "Only an unchanged draft can be discarded",
        );
        await s.quoteEvent(db, qid, "discarded", "Draft discarded");
        return { id: qid };
      }),
    );
  }
  if (path.length !== 3) return;
  if (path[2] === "pdf" && req.method === "GET") {
    const p = await s.quotePDF(qid);
    return new Response(new Uint8Array(p.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${new URL(req.url).searchParams.get("preview") === "1" ? "inline" : "attachment"}; filename="Quote-${p.number}.pdf"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (req.method !== "POST") return;
  if (path[2] === "publish") {
    const p = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(await read(req));
    return json(await s.publishQuote(qid, p.version, requestId(req)));
  }
  if (path[2] === "decision") {
    const p = z
      .object({
        version: z.number().int().positive(),
        state: z.enum(["accepted", "declined", "void"]),
        reason: text(1000),
      })
      .strict()
      .parse(await read(req));
    return json(await s.transitionQuote(qid, p.version, p.state, p.reason));
  }
  if (path[2] === "revise") {
    z.object({})
      .strict()
      .parse(await read(req));
    return json(await s.reviseQuote(qid, requestId(req)), 201);
  }
  if (path[2] === "convert") {
    const p = z
      .object({ target: z.enum(["job", "invoice"]) })
      .strict()
      .parse(await read(req));
    return json(await s.convertQuote(qid, p.target, requestId(req)), 201);
  }
}
