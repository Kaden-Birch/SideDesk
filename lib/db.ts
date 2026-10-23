import pg, { type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "./config";
const globalDb = globalThis as unknown as { sidePool?: pg.Pool };
export function pool() {
  return (globalDb.sidePool ??= new pg.Pool({
    connectionString: config().DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 5000,
  }));
}
export function database() {
  return drizzle(pool());
}
export async function transaction<T>(
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock_shared(938421)");
    const v = await fn(db);
    await db.query("COMMIT");
    return v;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
