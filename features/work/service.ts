import type { PoolClient } from "pg";
import { requireValue } from "@/lib/auth";
export async function effective(
  db: PoolClient,
  activityId: string,
  override?: number | null,
) {
  const r = await db.query(
    `SELECT a.billable,a.job_id,COALESCE(j.hourly_rate_minor,c.hourly_rate_minor,b.hourly_rate_minor) AS rate_minor,
 CASE WHEN j.hourly_rate_minor IS NOT NULL THEN 'job' WHEN c.hourly_rate_minor IS NOT NULL THEN 'client' ELSE 'business' END AS rate_source,
 b.rounding_minutes,b.rounding_scope FROM activity a JOIN client c ON c.id=a.client_id LEFT JOIN job j ON j.id=a.job_id CROSS JOIN business_settings b WHERE a.id=$1`,
    [activityId],
  );
  requireValue(r.rowCount, 404, "Activity not found");
  const e = r.rows[0];
  if (override != null) {
    e.rate_minor = String(override);
    e.rate_source = "entry";
  }
  return e;
}
