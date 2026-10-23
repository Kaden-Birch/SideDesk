import { readdir, readFile } from "node:fs/promises";
import { pool } from "../lib/db";
import { createHash } from "node:crypto";
export async function migrate() {
  const db = await pool().connect();
  try {
    await db.query("SELECT pg_advisory_lock(938422)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migration(name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir("db/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = await readFile("db/migrations/" + name, "utf8"),
        sha = createHash("sha256").update(sql).digest("hex");
      const prior = await db.query(
        "SELECT sha256 FROM schema_migration WHERE name=$1",
        [name],
      );
      if (prior.rowCount) {
        if (prior.rows[0].sha256 !== sha)
          throw new Error("Applied migration changed: " + name);
        continue;
      }
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query(
          "INSERT INTO schema_migration(name,sha256) VALUES($1,$2)",
          [name, sha],
        );
        await db.query("COMMIT");
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      }
      console.log("Applied", name);
    }
  } finally {
    await db.query("SELECT pg_advisory_unlock(938422)");
    db.release();
  }
}
if (process.argv[1]?.endsWith("migrate.ts"))
  migrate()
    .then(() => pool().end())
    .catch(() => {
      console.error(
        "Migration failed; check database connectivity and migration integrity.",
      );
      process.exitCode = 1;
      return pool().end();
    });
