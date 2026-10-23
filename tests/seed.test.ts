import { it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { migrate } from "../scripts/migrate";
import { pool } from "../lib/db";
import { api } from "../lib/api";
const exec = promisify(execFile);
it("seeds a fictional job/time/draft after setup and refuses repeat seeding", async () => {
  const dir = await mkdtemp(tmpdir() + "/sidedesk-seed-");
  const pg = new EmbeddedPostgres({
    databaseDir: dir + "/db",
    user: "test",
    password: "test",
    port: 55435,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  try {
    await pg.initialise();
    await pg.start();
    Object.assign(process.env, {
      DATABASE_URL: "postgresql://test:test@127.0.0.1:55435/postgres",
      APP_URL: "http://localhost:3298",
      SESSION_SECRET: "fictional-seed-session-secret-1234567890123456",
      SETUP_TOKEN: "fictional-seed-setup-token-1234567890123456",
    });
    await migrate();
    const state = await api(
      new Request("http://localhost:3298/api/state", {
        headers: { host: "localhost:3298" },
      }),
      ["state"],
    );
    const csrf = (await state.json()).csrf;
    const response = await api(
      new Request("http://localhost:3298/api/setup", {
        method: "POST",
        headers: {
          host: "localhost:3298",
          origin: "http://localhost:3298",
          "content-type": "application/json",
          "x-csrf-token": csrf,
          cookie: state.headers.get("set-cookie")!.split(";")[0],
        },
        body: JSON.stringify({
          login_name: "fictional-seed-owner",
          password: "fictional-seed-login-password",
          setup_token: process.env.SETUP_TOKEN,
          name: "Fictional demo",
        }),
      }),
      ["setup"],
    );
    expect(response.status).toBe(200);
    const options = { env: { ...process.env, ALLOW_FICTIONAL_SEED: "yes" } };
    await exec(
      process.execPath,
      ["--import", "tsx", "scripts/seed.ts"],
      options,
    );
    const result = await pool().query(
      "SELECT (SELECT count(*)::int FROM job) AS jobs,(SELECT count(*)::int FROM invoice WHERE state='draft') AS drafts,(SELECT count(*)::int FROM invoice_allocation) AS allocations,(SELECT count(*)::int FROM vault) AS vaults",
    );
    expect(result.rows[0]).toEqual({
      jobs: 1,
      drafts: 1,
      allocations: 1,
      vaults: 0,
    });
    await expect(
      exec(process.execPath, ["--import", "tsx", "scripts/seed.ts"], options),
    ).rejects.toThrow();
  } finally {
    await pool().end();
    await pg.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
