import { jobFiles } from "./files";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "@/lib/db";
import { json, read, once, requestId } from "@/lib/http";
import { id } from "@/lib/validation";
import { jobInput } from "@/features/billing/model";
import { requireValue } from "@/lib/auth";
export async function jobRoutes(
  req: Request,
  path: string[],
): Promise<Response | undefined> {
  if (path[0] !== "jobs") return;
  const files = await jobFiles(req, path);
  if (files) return files;
  const method = req.method;
  if (path.length === 1 && method === "GET")
    return json(
      (
        await pool().query(
          `SELECT j.*,j.due_date::text,c.name AS client_name,COALESCE(t.seconds,0)::int AS duration_seconds,COALESCE(t.unbilled,0)::int AS unbilled_seconds FROM job j JOIN client c ON c.id=j.client_id LEFT JOIN LATERAL(SELECT sum(duration_seconds) AS seconds,sum(CASE WHEN billable AND NOT EXISTS(SELECT 1 FROM invoice_allocation x WHERE x.time_entry_id=e.id AND x.released_at IS NULL) THEN duration_seconds ELSE 0 END) AS unbilled FROM time_entry e WHERE e.job_id=j.id)t ON true ORDER BY j.created_at DESC`,
        )
      ).rows,
    );
  if (path.length === 1 && method === "POST") {
    const p = jobInput.parse(await read(req));
    return json(
      await transaction((db) =>
        once(db, requestId(req), "job-create", p, async () => {
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
          const jid = randomUUID();
          await db.query(
            "INSERT INTO job(id,client_id,title,description,status,priority,due_date,hourly_rate_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              jid,
              p.client_id,
              p.title,
              p.description,
              p.status,
              p.priority,
              p.due_date,
              p.hourly_rate_minor,
            ],
          );
          return { id: jid };
        }),
      ),
      201,
    );
  }
  if (path.length !== 2) return;
  const jid = id.parse(path[1]);
  if (method === "GET") {
    const j = (
      await pool().query(
        "SELECT j.*,j.due_date::text,c.name AS client_name FROM job j JOIN client c ON c.id=j.client_id WHERE j.id=$1",
        [jid],
      )
    ).rows[0];
    requireValue(j, 404, "Job not found");
    const [a, t, n, invoices] = await Promise.all([
      pool().query(
        "SELECT a.*,COALESCE((SELECT sum(duration_seconds) FROM time_entry WHERE activity_id=a.id),0)::int AS duration_seconds FROM activity a WHERE a.job_id=$1 ORDER BY created_at DESC",
        [jid],
      ),
      pool().query(
        "SELECT *,COALESCE((SELECT i.number FROM invoice_allocation x JOIN invoice i ON i.id=x.invoice_id WHERE x.time_entry_id=t.id AND x.released_at IS NULL),'') AS invoice_number FROM time_entry t WHERE t.job_id=$1 ORDER BY created_at DESC",
        [jid],
      ),
      pool().query(
        "SELECT * FROM note WHERE job_id=$1 ORDER BY created_at DESC",
        [jid],
      ),
      pool().query(
        "SELECT DISTINCT i.id,i.number,i.state FROM invoice i JOIN invoice_allocation x ON x.invoice_id=i.id JOIN time_entry t ON t.id=x.time_entry_id WHERE t.job_id=$1",
        [jid],
      ),
    ]);
    return json({
      ...j,
      activities: a.rows,
      entries: t.rows,
      notes: n.rows,
      invoices: invoices.rows,
    });
  }
  if (method === "PUT") {
    const p = jobInput
      .extend({ version: z.number().int().positive() })
      .parse(await read(req));
    const r = await transaction((db) =>
      db.query(
        "UPDATE job SET title=$1,description=$2,status=$3,priority=$4,due_date=$5,hourly_rate_minor=$6,version=version+1,updated_at=now() WHERE id=$7 AND client_id=$8 AND version=$9 RETURNING id",
        [
          p.title,
          p.description,
          p.status,
          p.priority,
          p.due_date,
          p.hourly_rate_minor,
          jid,
          p.client_id,
          p.version,
        ],
      ),
    );
    requireValue(
      r.rowCount,
      409,
      "Job changed, or client cannot be changed. Reload first.",
    );
    return json(r.rows[0]);
  }
}
