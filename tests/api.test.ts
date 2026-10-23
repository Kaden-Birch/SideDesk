import { beforeAll, afterAll, it, expect, vi } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { api } from "../lib/api";
import { pool } from "../lib/db";
import { migrate } from "../scripts/migrate";
import * as crypto from "../features/vault/crypto";
let pg: EmbeddedPostgres,
  dir: string,
  cookie = "",
  csrf = "",
  clientId = "",
  activityId = "";
const setup = {
  login_name: "fictional-owner",
  password: "fictional-login-password",
  setup_token: "fictional-setup-token-12345678901234567890",
  name: "Demo business",
};
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  extras: Record<string, string> = {},
) {
  return api(
    new Request("http://localhost:3199/api/" + path, {
      method,
      headers: {
        host: "localhost:3199",
        origin: "http://localhost:3199",
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrf,
        ...extras,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split("/"),
  );
}
async function state() {
  const r = await call("state");
  const c = r.headers.get("set-cookie");
  if (c) cookie = c.split(";")[0];
  const s = await r.json();
  csrf = s.csrf;
  return s;
}
beforeAll(async () => {
  dir = await mkdtemp(tmpdir() + "/sidedesk-test-");
  pg = new EmbeddedPostgres({
    databaseDir: dir + "/db",
    user: "test",
    password: "test",
    port: 55433,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  await pg.initialise();
  await pg.start();
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:55433/postgres";
  process.env.APP_URL = "http://localhost:3199";
  process.env.SESSION_SECRET =
    "fictional-test-session-secret-12345678901234567890";
  process.env.SETUP_TOKEN = setup.setup_token;
  vi.stubGlobal("isSecureContext", true);
  await migrate();
  await migrate();
});
afterAll(async () => {
  await pool().end();
  await pg?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
it("first-run race creates one owner; session cookies are HttpOnly; setup closes", async () => {
  await state();
  const results = await Promise.all([
    call("setup", "POST", setup),
    call("setup", "POST", setup),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const success = results.find((r) => r.status === 200)!;
  expect(success.headers.get("set-cookie")).toContain("HttpOnly");
  cookie = success.headers.get("set-cookie")!.split(";")[0];
  await state();
  expect(
    (await pool().query("SELECT count(*)::int AS n FROM owner")).rows[0].n,
  ).toBe(1);
  expect((await call("setup", "POST", setup)).status).toBe(403);
});
it("rejects forged origins, CSRF, and unauthenticated writes", async () => {
  expect(
    (await call("clients", "POST", {}, { origin: "http://evil.invalid" }))
      .status,
  ).toBe(403);
  expect(
    (await call("clients", "POST", {}, { "x-csrf-token": "wrong" })).status,
  ).toBe(403);
  expect((await call("clients", "POST", {}, { cookie: "" })).status).toBe(401);
});
it("creates a client, contact, safe contextual note, and 25-minute activity once", async () => {
  const c = await call("clients", "POST", {
    name: "Fictional client",
    type: "business",
  });
  expect(c.status).toBe(201);
  clientId = (await c.json()).id;
  expect(
    (
      await call("contacts", "POST", {
        client_id: clientId,
        name: "Fictional contact",
        email: "demo@example.invalid",
        phone: "",
        role: "IT",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await call("notes", "POST", {
        client_id: clientId,
        activity_id: null,
        body: "<script>never execute</script> **context**",
      })
    ).status,
  ).toBe(201);
  const key = randomUUID(),
    body = {
      client_id: clientId,
      title: "Fictional 25-minute activity",
      billable: true,
      duration_seconds: 1500,
    };
  const r = await call("activities", "POST", body, { "idempotency-key": key });
  expect(r.status).toBe(201);
  activityId = (await r.json()).id;
  expect(
    (await call("activities", "POST", body, { "idempotency-key": key })).status,
  ).toBe(201);
  expect(
    (await pool().query("SELECT count(*)::int AS n FROM time_entry")).rows[0].n,
  ).toBe(1);
  expect(
    (
      await call(
        "activities",
        "POST",
        { ...body, title: "changed" },
        { "idempotency-key": key },
      )
    ).status,
  ).toBe(409);
});
it("enforces one persistent active timer, versions, pause/resume and idempotent stop", async () => {
  let r = await call(
    "timer",
    "POST",
    { action: "start", activity_id: activityId },
    { "idempotency-key": randomUUID() },
  );
  expect(r.status).toBe(200);
  let t = await r.json();
  expect(
    (
      await call(
        "timer",
        "POST",
        { action: "start", activity_id: activityId },
        { "idempotency-key": randomUUID() },
      )
    ).status,
  ).toBe(409);
  await pool().query(
    "UPDATE timer SET segment_started_at=now()-interval '65 seconds' WHERE id=$1",
    [t.id],
  );
  r = await call(
    "timer",
    "POST",
    { action: "pause", timer_id: t.id, version: t.version },
    { "idempotency-key": randomUUID() },
  );
  t = await r.json();
  expect(t.accumulated_seconds).toBeGreaterThanOrEqual(65);
  expect(
    (
      await call(
        "timer",
        "POST",
        { action: "resume", timer_id: t.id, version: 1 },
        { "idempotency-key": randomUUID() },
      )
    ).status,
  ).toBe(409);
  t = await (
    await call(
      "timer",
      "POST",
      { action: "resume", timer_id: t.id, version: t.version },
      { "idempotency-key": randomUUID() },
    )
  ).json();
  const key = randomUUID(),
    body = { action: "stop", timer_id: t.id, version: t.version };
  expect(
    (await call("timer", "POST", body, { "idempotency-key": key })).status,
  ).toBe(200);
  expect(
    (await call("timer", "POST", body, { "idempotency-key": key })).status,
  ).toBe(200);
  expect(
    (
      await pool().query(
        "SELECT count(*)::int AS n FROM time_entry WHERE timer_id=$1",
        [t.id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect((await (await call("timer")).json()).timer).toBeNull();
});
it("persists ciphertext only, rejects replayed nonces and never joins payloads into client responses", async () => {
  const recovery = await crypto.recoveryKey(),
    created = await crypto.initialize("fictional-vault-password", recovery);
  const { version: _, ...wire } = created.vault;
  void _;
  expect((await call("vault", "POST", wire)).status).toBe(201);
  const cid = randomUUID(),
    payload = await crypto.encrypt(created.vault, created.vmk, cid, clientId, {
      ...crypto.emptySecret,
      password: "KNOWN_SECRET_MARKER_7429",
      username: "KNOWN_USERNAME_MARKER_7429",
    });
  expect(
    (
      await call("credentials", "POST", {
        id: cid,
        client_id: clientId,
        title: "Fictional login",
        payload,
        version: 0,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await call("credentials", "PUT", {
        id: cid,
        client_id: clientId,
        title: "Fictional login",
        payload,
        version: 1,
      })
    ).status,
  ).toBe(409);
  const client = await (await call("clients/" + clientId)).json();
  expect(client.credentials[0].payload).toBeUndefined();
  expect(JSON.stringify(client)).not.toContain("KNOWN_");
  const dump = await pool().query(
    "SELECT row_to_json(c)::text AS value FROM credential c UNION ALL SELECT row_to_json(v)::text FROM vault v UNION ALL SELECT row_to_json(a)::text FROM credential_audit_event a",
  );
  expect(JSON.stringify(dump.rows)).not.toContain("KNOWN_");
  expect(
    (
      await call("credentials", "POST", {
        id: randomUUID(),
        client_id: clientId,
        title: "bad",
        payload,
        version: 0,
        password: "KNOWN_PLAINTEXT",
      })
    ).status,
  ).toBe(400);
  created.vmk.fill(0);
});
it("enforces optimistic concurrency on client changes", async () => {
  const c = await (await call("clients/" + clientId)).json();
  const body = {
    name: c.name,
    type: c.type,
    email: c.email,
    phone: c.phone,
    billing_address: c.billing_address,
    hourly_rate_minor: null,
    version: c.version,
  };
  expect((await call("clients/" + clientId, "PUT", body)).status).toBe(200);
  expect((await call("clients/" + clientId, "PUT", body)).status).toBe(409);
});
it("invalidates logout sessions and idle-expired sessions", async () => {
  expect((await call("logout", "POST", {})).status).toBe(200);
  expect((await call("clients")).status).toBe(401);
  await state();
  const r = await call("login", "POST", {
    login_name: setup.login_name,
    password: setup.password,
  });
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  await state();
  await pool().query(
    "UPDATE session SET last_seen_at=now()-interval '31 minutes'",
  );
  expect((await call("clients")).status).toBe(401);
});
