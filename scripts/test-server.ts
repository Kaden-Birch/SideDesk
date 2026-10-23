import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
const root = process.cwd();
await mkdir("work", { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir: await mkdtemp(root + "/work/e2e-postgres-"),
  user: "test_owner",
  password: "test-local-postgres-password",
  port: 55432,
  persistent: false,
  authMethod: "scram-sha-256",
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
try {
  await pg.initialise();
} catch (e) {
  if (!String(e).includes("exists")) throw e;
}
await pg.start();
process.env.DATABASE_URL =
  "postgresql://test_owner:test-local-postgres-password@127.0.0.1:55432/postgres";
process.env.APP_URL = "http://localhost:3100";
process.env.SESSION_SECRET =
  "test-session-secret-for-local-tests-only-123456789";
process.env.SETUP_TOKEN = "test-bootstrap-token-for-local-tests-only-123456789";
process.env.FILE_STORAGE_PATH = root + "/work/uploads";
process.env.BACKUP_DIR = root + "/work/backups";
process.env.NEXT_TELEMETRY_DISABLED = "1";
const { migrate } = await import("./migrate");
await migrate();
const { pool } = await import("../lib/db");
await pool().end();
const children = [
  spawn(process.execPath, [".next/standalone/server.js"], {
    stdio: "inherit",
    env: { ...process.env, PORT: "3100", HOSTNAME: "0.0.0.0" },
  }),
  spawn(process.execPath, [".next/standalone/server.js"], {
    stdio: "inherit",
    env: {
      ...process.env,
      APP_URL: "http://sidedesk.test:3101",
      PORT: "3101",
      HOSTNAME: "0.0.0.0",
    },
  }),
];
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  children.forEach((c) => c.kill("SIGTERM"));
  await pg.stop();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
