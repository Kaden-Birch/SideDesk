import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "@/lib/db";
import { requireValue } from "@/lib/auth";
import { json, read, once, requestId } from "@/lib/http";
import { id } from "@/lib/validation";
import { taxComponents } from "./taxes";
const input = z
  .object({ name: z.string().trim().min(1).max(80), components: taxComponents })
  .strict();
export async function taxRoutes(req: Request, path: string[]) {
  if (path[0] !== "tax-profiles") return;
  if (path.length === 1 && req.method === "GET")
    return json(
      (
        await pool().query(
          "SELECT * FROM tax_profile WHERE archived_at IS NULL ORDER BY name",
        )
      ).rows,
    );
  if (path.length === 1 && req.method === "POST") {
    const p = input.parse(await read(req));
    return json(
      await transaction((db) =>
        once(db, requestId(req), "tax-profile", p, async () => {
          const tid = randomUUID();
          await db.query(
            "INSERT INTO tax_profile(id,name,components) VALUES($1,$2,$3)",
            [tid, p.name, JSON.stringify(p.components)],
          );
          return { id: tid };
        }),
      ),
      201,
    );
  }
  if (path.length === 2 && req.method === "PUT") {
    const p = input
      .extend({ version: z.number().int().positive() })
      .parse(await read(req));
    const r = await transaction((db) =>
      db.query(
        "UPDATE tax_profile SET name=$1,components=$2,version=version+1,updated_at=now() WHERE id=$3 AND version=$4 AND archived_at IS NULL RETURNING id",
        [p.name, JSON.stringify(p.components), id.parse(path[1]), p.version],
      ),
    );
    requireValue(r.rowCount, 409, "Tax profile changed. Reload first.");
    return json(r.rows[0]);
  }
  if (path.length === 2 && req.method === "DELETE") {
    await transaction((db) =>
      db.query(
        "UPDATE tax_profile SET archived_at=now(),version=version+1 WHERE id=$1",
        [id.parse(path[1])],
      ),
    );
    return json({ ok: true });
  }
}
