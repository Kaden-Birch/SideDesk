import { mkdir, cp, writeFile, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pool } from "../lib/db";
import { config } from "../lib/config";
const exec = promisify(execFile);
export async function backup() {
  const c = config(),
    dir = path.join(
      c.BACKUP_DIR,
      "sidedesk-" + Date.now() + "-" + randomUUID().slice(0, 8),
    ),
    db = await pool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(938421)");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await mkdir(c.FILE_STORAGE_PATH, { recursive: true, mode: 0o700 });
    const u = new URL(c.DATABASE_URL);
    await exec(
      process.env.PG_DUMP_BIN || "pg_dump",
      ["--format=custom", "--file", path.join(dir, "database.dump")],
      {
        env: {
          ...process.env,
          PGHOST: u.hostname,
          PGPORT: u.port || "5432",
          PGUSER: decodeURIComponent(u.username),
          PGPASSWORD: decodeURIComponent(u.password),
          PGDATABASE: u.pathname.slice(1),
        },
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      },
    );
    await cp(c.FILE_STORAGE_PATH, path.join(dir, "uploads"), {
      recursive: true,
    });
    const hashes: Record<string, string> = {};
    async function walk(root: string, relative = "") {
      for (const e of await readdir(path.join(root, relative), {
        withFileTypes: true,
      })) {
        const f = path.join(relative, e.name);
        if (e.isDirectory()) await walk(root, f);
        else if (e.isFile())
          hashes[f] = createHash("sha256")
            .update(
              await readFile(
                /* turbopackIgnore: true */ path.join(
                  /* turbopackIgnore: true */ root,
                  f,
                ),
              ),
            )
            .digest("hex");
      }
    }
    await walk(dir);
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify(
        {
          format: 1,
          appVersion: "0.1.0",
          created_at: new Date().toISOString(),
          vault: "ciphertext and wrapped envelopes in database.dump",
          deploymentSecrets: "back up separately; not in this manifest",
          sha256: hashes,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await db.query("COMMIT");
    return dir;
  } catch (e) {
    await db.query("ROLLBACK");
    await rm(dir, { recursive: true, force: true });
    throw e;
  } finally {
    db.release();
  }
}
if (process.argv[1]?.endsWith("backup.ts"))
  backup()
    .then((dir) => console.log("Backup complete:", dir))
    .catch(() => {
      console.error(
        "Backup failed; verify pg_dump, permissions and database connectivity.",
      );
      process.exitCode = 1;
    })
    .finally(() => pool().end());
