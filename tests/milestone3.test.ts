import { beforeAll, afterAll, it, expect, vi } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import nodemailer from "nodemailer";
import { api } from "../lib/api";
import { pool } from "../lib/db";
import { migrate } from "../scripts/migrate";
import { sealPassword, openPassword } from "../features/email/service";
import { calculateTaxes } from "../features/billing/taxes";
import type { Invoice } from "../features/billing/model";
import type { Quote } from "../features/quotes/service";
let dir: string,
  pg: EmbeddedPostgres,
  cookie = "",
  csrf = "",
  client = "",
  server: SMTPServer,
  port = 0,
  sends = 0;
const messages: string[] = [];
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  key: string = randomUUID(),
) {
  return api(
    new Request("http://localhost:3297/api/" + path, {
      method,
      headers: {
        host: "localhost:3297",
        origin: "http://localhost:3297",
        cookie,
        "x-csrf-token": csrf,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split("/"),
  );
}
async function body<T>(
  path: string,
  method = "GET",
  value?: unknown,
  key?: string,
): Promise<T> {
  const r = await call(path, method, value, key);
  const p = await r.json();
  expect(r.status, `${method} ${path}: ${JSON.stringify(p)}`).toBeLessThan(300);
  return p;
}
const manual = {
  kind: "manual",
  description: "Fictional agreed service",
  quantity: "1",
  unit_minor: 10000,
  discount_bps: 0,
  tax_bps: 0,
  tax_label: "Tax",
};
async function invoice(lines: unknown[] = [manual]) {
  const d = await body<{ id: string }>("invoices", "POST", {
    client_id: client,
    issue_date: "2030-01-01",
    due_date: "2030-01-31",
    lines,
  });
  const i = await body<Invoice>("invoices/" + d.id);
  await body("invoices/" + d.id + "/issue", "POST", { version: i.version });
  return d.id;
}
async function quote() {
  const d = await body<{ id: string }>("quotes", "POST", {
    client_id: client,
    issue_date: "2030-01-01",
    expiry_date: "2030-02-01",
    lines: [
      {
        ...manual,
        quantity: "1.125",
        tax_components: [
          {
            label: "Configured GST",
            rate_milli_percent: 5000,
            compound: false,
          },
        ],
      },
    ],
  });
  const q = await body<Quote>("quotes/" + d.id);
  await body("quotes/" + d.id + "/publish", "POST", { version: q.version });
  return d.id;
}
async function smtp(password = "fixture-password") {
  const current = await body<{ version?: number }>("smtp");
  return body("smtp", "PUT", {
    version: current.version || 0,
    host: "127.0.0.1",
    port,
    security: "starttls",
    username: "fixture-owner",
    password,
    from_address: "owner@example.invalid",
    from_name: "Fictional SideDesk",
  });
}
beforeAll(async () => {
  dir = await mkdtemp(tmpdir() + "/sidedesk-m3-");
  pg = new EmbeddedPostgres({
    databaseDir: dir + "/db",
    user: "test",
    password: "test",
    port: 55436,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  await pg.initialise();
  await pg.start();
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://test:test@127.0.0.1:55436/postgres",
    APP_URL: "http://localhost:3297",
    SESSION_SECRET: "fictional-m3-session-secret-1234567890123456789",
    SETUP_TOKEN: "fictional-m3-setup-token-1234567890123456789",
    FILE_STORAGE_PATH: dir + "/uploads",
    SMTP_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  });
  await migrate();
  const state = await call("state");
  cookie = state.headers.get("set-cookie")!.split(";")[0];
  csrf = (await state.json()).csrf;
  const setup = await call("setup", "POST", {
    login_name: "fictional-m3-owner",
    password: "fictional-m3-owner-password",
    setup_token: process.env.SETUP_TOKEN,
    name: "Fictional M3 Studio",
  });
  expect(setup.status).toBe(200);
  cookie = setup.headers.get("set-cookie")!.split(";")[0];
  csrf = (await (await call("state")).json()).csrf;
  client = (
    await body<{ id: string }>("clients", "POST", {
      name: "Fictional M3 client",
      type: "business",
    })
  ).id;
  await pool().query("UPDATE business_settings SET tax_enabled=true");
  await promisify(execFile)("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    dir + "/smtp.key",
    "-out",
    dir + "/smtp.pem",
    "-days",
    "2",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
  process.env.SMTP_CA_FILE = dir + "/smtp.pem";
  server = new SMTPServer({
    secure: false,
    key: await readFile(dir + "/smtp.key"),
    cert: await readFile(dir + "/smtp.pem"),
    logger: false,
    onAuth(auth, _session, done) {
      if (
        auth.username === "fixture-owner" &&
        auth.password === "fixture-password"
      )
        done(null, { user: "fixture-owner" });
      else
        done(
          Object.assign(new Error("Rejected fictional credentials"), {
            responseCode: 535,
          }),
        );
    },
    onData(stream, _session, done) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("end", () => {
        sends++;
        messages.push(Buffer.concat(chunks).toString());
        done();
      });
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.server.address() as AddressInfo).port;
}, 30000);
afterAll(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise<void>((resolve) => server.close(resolve));
  await pool().end();
  await pg?.stop();
  await rm(dir, { recursive: true, force: true });
});
it("calculates separate and compounded three-decimal taxes without assuming registration", async () => {
  const taxes = [
    { label: "Configured GST", rate_milli_percent: 5000, compound: false },
    { label: "Configured QST", rate_milli_percent: 9975, compound: false },
  ];
  expect(calculateTaxes(10000, taxes).map((t) => t.amount_minor)).toEqual([
    500, 998,
  ]);
  expect(
    calculateTaxes(10000, [taxes[0], { ...taxes[1], compound: true }]).map(
      (t) => t.amount_minor,
    ),
  ).toEqual([500, 1047]);
  const d = await body<{ id: string }>("invoices", "POST", {
    client_id: client,
    issue_date: "2030-01-01",
    due_date: "2030-01-31",
    lines: [
      { ...manual, tax_components: taxes },
      { ...manual, tax_components: taxes, tax_treatment: "exempt" },
    ],
  });
  const i = await body<Invoice>("invoices/" + d.id);
  expect(i.total_minor).toBe(21498);
  expect(i.lines[0].tax_snapshot?.[1].rate_milli_percent).toBe(9975);
  expect(i.lines[1].tax_minor).toBe(0);
});
it("freezes published quotes and preserves agreed snapshots during concurrent conversion despite changed settings", async () => {
  const qid = await quote(),
    q = await body<Quote>("quotes/" + qid),
    pdf = Buffer.from(
      await (await call("quotes/" + qid + "/pdf")).arrayBuffer(),
    );
  await expect(
    pool().query("UPDATE quote SET total_minor=1 WHERE id=$1", [qid]),
  ).rejects.toMatchObject({ code: "23514" });
  expect(
    (await call("quotes/" + qid + "/convert", "POST", { target: "invoice" }))
      .status,
  ).toBe(409);
  await body("quotes/" + qid + "/decision", "POST", {
    version: q.version,
    state: "accepted",
    reason: "Fictional written acceptance",
  });
  await pool().query(
    "UPDATE business_settings SET tax_enabled=false,hourly_rate_minor=99999",
  );
  await pool().query(
    "UPDATE client SET name='Changed client name' WHERE id=$1",
    [client],
  );
  const [a, b] = await Promise.all([
    body<{ id: string }>("quotes/" + qid + "/convert", "POST", {
      target: "invoice",
    }),
    body<{ id: string }>("quotes/" + qid + "/convert", "POST", {
      target: "invoice",
    }),
  ]);
  expect(a.id).toBe(b.id);
  const i = await body<Invoice>("invoices/" + a.id);
  expect(i.total_minor).toBe(q.document.total_minor);
  expect(i.client_snapshot).toEqual(q.document.client);
  expect(i.lines.map((l) => l.tax_snapshot)).toEqual(
    q.document.lines.map((l) => l.tax_snapshot),
  );
  expect(i.source_quote_id).toBe(qid);
  const job = await body<{ id: string }>("quotes/" + qid + "/convert", "POST", {
    target: "job",
  });
  expect(
    (
      await body<{ id: string }>("quotes/" + qid + "/convert", "POST", {
        target: "job",
      })
    ).id,
  ).toBe(job.id);
  expect(
    Buffer.from(
      await (await call("quotes/" + qid + "/pdf")).arrayBuffer(),
    ).equals(pdf),
  ).toBe(true);
  const revision = await body<{ id: string }>(
    "quotes/" + qid + "/revise",
    "POST",
    {},
  );
  expect((await body<Quote>("quotes/" + revision.id)).state).toBe("draft");
  await pool().query("UPDATE business_settings SET tax_enabled=true");
});
it("keeps credits, refunds and reversals append-only while reconciling balances and protecting receipts", async () => {
  const iid = await invoice(),
    path = "invoices/" + iid;
  await body(path + "/payments", "POST", {
    amount_minor: 10000,
    method: "cash",
    received_on: "2030-01-01",
  });
  const credit = await body<{ id: string }>(path + "/adjustments", "POST", {
    kind: "credit",
    amount_minor: 3000,
    occurred_on: "2030-01-01",
    reason: "Fictional service credit",
  });
  expect((await body<Invoice>(path)).customer_credit_minor).toBe(3000);
  const refund = await body<{ id: string }>(path + "/adjustments", "POST", {
    kind: "refund",
    amount_minor: 2000,
    occurred_on: "2030-01-02",
    reason: "Fictional external refund recorded",
    method: "cash",
  });
  const i = await body<Invoice>(path);
  expect([i.received_minor, i.balance_minor, i.customer_credit_minor]).toEqual([
    8000, 0, 1000,
  ]);
  expect(
    (
      await call(path + "/adjustments", "POST", {
        kind: "refund",
        amount_minor: 1001,
        occurred_on: "2030-01-02",
        reason: "Excess",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(path + "/payments/" + i.payments[0].id + "/reverse", "POST", {
        reason: "Invalid reversal before refund correction",
      })
    ).status,
  ).toBe(409);
  await body(path + "/adjustments/" + credit.id + "/reverse", "POST", {
    reason: "Reverse incorrect credit",
  });
  expect((await body<Invoice>(path)).balance_minor).toBe(2000);
  await body(path + "/adjustments/" + refund.id + "/reverse", "POST", {
    reason: "Refund did not happen",
  });
  expect((await body<Invoice>(path)).balance_minor).toBe(0);
  await expect(
    pool().query("DELETE FROM invoice_adjustment WHERE id=$1", [credit.id]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("separates expense costs from recovery charges and reserves each full charge only once", async () => {
  const cost = await body<{ id: string }>("expenses", "POST", {
    vendor: "Fictional vendor",
    spent_on: "2030-01-01",
    amount_minor: 10500,
    tax_minor: 500,
    category: "Supplies",
    client_id: client,
    billable: true,
    recovery_minor: 12000,
  });
  await body("expenses", "POST", {
    vendor: "Business only vendor",
    spent_on: "2030-01-01",
    amount_minor: 9000,
    category: "Office",
    billable: false,
  });
  const charges =
      await body<{ id: string; expense_id: string; amount_minor: string }[]>(
        "unbilled-charges",
      ),
    charge = charges.find((c) => c.expense_id === cost.id)!;
  expect(charge.amount_minor).toBe("12000");
  expect(charges).toHaveLength(1);
  const results = await Promise.all([
    call("invoices/from-charges", "POST", {
      client_id: client,
      charge_ids: [charge.id],
    }),
    call("invoices/from-charges", "POST", {
      client_id: client,
      charge_ids: [charge.id],
    }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const draft = await results.find((r) => r.status === 201)!.json();
  const i = await body<Invoice>("invoices/" + draft.id);
  expect(i.total_minor).toBe(12000);
  expect(i.lines[0].kind).toBe("charge");
  expect((await body<unknown[]>("unbilled-charges")).length).toBe(0);
  await expect(
    pool().query("UPDATE expense SET amount_minor=1 WHERE id=$1", [cost.id]),
  ).rejects.toMatchObject({ code: "23514" });
  await body("invoices/" + draft.id, "DELETE", { version: i.version });
  expect((await body<unknown[]>("unbilled-charges")).length).toBe(1);
});
it("calculates manual mileage and separately rounded travel labour into traceable charges", async () => {
  const trip = await body<{ id: string }>("trips", "POST", {
    travelled_on: "2030-01-01",
    purpose: "Fictional service visit",
    distance_milli_km: 10125,
    duration_seconds: 720,
    mileage_rate_minor: 70,
    time_rate_minor: 10000,
    rounding_minutes: 15,
    client_id: client,
    billable_mileage: true,
    billable_time: true,
  });
  const charges = (
    await body<
      { id: string; trip_id: string; kind: string; amount_minor: string }[]
    >("unbilled-charges")
  ).filter((c) => c.trip_id === trip.id);
  expect(
    charges.map((c) => Number(c.amount_minor)).sort((a, b) => a - b),
  ).toEqual([709, 2500]);
  const d = await body<{ id: string }>("invoices/from-charges", "POST", {
    client_id: client,
    charge_ids: charges.map((c) => c.id),
  });
  const i = await body<Invoice>("invoices/" + d.id);
  expect(i.total_minor).toBe(3209);
  await body("invoices/" + d.id + "/issue", "POST", { version: i.version });
  await body("invoices/" + d.id + "/void", "POST", {
    version: (await body<Invoice>("invoices/" + d.id)).version,
    reason: "Fictional cancelled visit",
  });
  expect(
    (await body<{ trip_id: string }[]>("unbilled-charges")).filter(
      (c) => c.trip_id === trip.id,
    ),
  ).toHaveLength(2);
});
it("encrypts SMTP credentials with a dedicated authenticated key and fails closed on missing, wrong or corrupt keys", async () => {
  const secret = "FICTIONAL_SMTP_PASSWORD_67291",
    key = process.env.SMTP_ENCRYPTION_KEY!,
    a = sealPassword(secret),
    b = sealPassword(secret);
  expect(a.nonce).not.toBe(b.nonce);
  expect(JSON.stringify(a)).not.toContain(secret);
  expect(openPassword(a)).toBe(secret);
  expect(() => openPassword({ ...a, tag: b.tag })).toThrow();
  process.env.SMTP_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  expect(() => openPassword(a)).toThrow();
  delete process.env.SMTP_ENCRYPTION_KEY;
  expect(() => sealPassword(secret)).toThrow();
  process.env.SMTP_ENCRYPTION_KEY = key;
  await smtp(secret);
  const safe = await body<Record<string, unknown>>("smtp");
  expect(JSON.stringify(safe)).not.toContain(secret);
  expect(safe).not.toHaveProperty("password_envelope");
  expect(
    JSON.stringify(
      (await pool().query("SELECT password_envelope FROM smtp_settings")).rows,
    ),
  ).not.toContain(secret);
  expect(
    (
      await call("smtp", "PUT", {
        version: safe.version,
        host: "127.0.0.1",
        port,
        security: "plain",
        username: "fixture-owner",
        password: secret,
        from_address: "owner@example.invalid",
        from_name: "Demo",
      })
    ).status,
  ).toBe(400);
});
it("records SMTP rejection without sent state, then accepts one immutable PDF with idempotent retries", async () => {
  const qid = await quote(),
    path = "quotes/" + qid + "/email";
  await smtp("wrong-fixture-password");
  const p = {
    recipient: "client@example.invalid",
    subject: "Fictional quote",
    body: "Fictional test only",
  };
  const failed = await body<{ outcome: string }>(path, "POST", p);
  expect(failed.outcome).toBe("failed");
  expect((await body<Quote>("quotes/" + qid)).state).toBe("published");
  await smtp();
  expect((await call("smtp/test", "POST", {})).status).toBe(200);
  const before = sends,
    key = randomUUID();
  const accepted = await body<{ id: string; outcome: string }>(
    path,
    "POST",
    p,
    key,
  );
  expect(accepted.outcome).toBe("accepted");
  expect((await body<Quote>("quotes/" + qid)).state).toBe("sent");
  expect((await body<{ id: string }>(path, "POST", p, key)).id).toBe(
    accepted.id,
  );
  expect(sends).toBe(before + 1);
  expect(messages.at(-1)).toContain("Quote.pdf");
  expect(messages.at(-1)).not.toContain("fixture-password");
  expect(await body<unknown[]>(path)).toHaveLength(2);
}, 30000);
it("records ambiguous SMTP errors without automatic resending or a false sent state", async () => {
  const qid = await quote(),
    key = randomUUID(),
    p = {
      recipient: "client@example.invalid",
      subject: "Ambiguous fictional fixture",
      body: "Test",
    };
  const sendMail = vi.fn().mockRejectedValue(
    Object.assign(new Error("Connection dropped after DATA"), {
      code: "ESOCKET",
      command: "DATA",
    }),
  );
  const spy = vi
    .spyOn(nodemailer, "createTransport")
    .mockReturnValue({ sendMail, close() {} } as unknown as ReturnType<
      typeof nodemailer.createTransport
    >);
  try {
    const r = await body<{ outcome: string }>(
      "quotes/" + qid + "/email",
      "POST",
      p,
      key,
    );
    expect(r.outcome).toBe("unknown");
    await body("quotes/" + qid + "/email", "POST", p, key);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect((await body<Quote>("quotes/" + qid)).state).toBe("published");
  } finally {
    spy.mockRestore();
  }
});
it("lists expense/trip dates unambiguously and returns contextual details without server errors", async () => {
  const expenses = await body<{ id: string; spent_on: string }[]>("expenses"),
    trips = await body<{ id: string; travelled_on: string }[]>("trips");
  expect(expenses.length).toBeGreaterThan(0);
  expect(trips.length).toBeGreaterThan(0);
  expect(expenses[0].spent_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(trips[0].travelled_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect((await body<{ id: string }>("expenses/" + expenses[0].id)).id).toBe(
    expenses[0].id,
  );
  expect((await body<{ id: string }>("trips/" + trips[0].id)).id).toBe(
    trips[0].id,
  );
});
it("requires a new revision for expired quotes and prevents direct SQL conversion before acceptance", async () => {
  const q = await body<{ id: string }>("quotes", "POST", {
    client_id: client,
    issue_date: "2020-01-01",
    expiry_date: "2020-01-02",
    lines: [manual],
  });
  const draft = await body<Quote>("quotes/" + q.id);
  await body("quotes/" + q.id + "/publish", "POST", { version: draft.version });
  const expired = await body<Quote>("quotes/" + q.id);
  expect(expired.status).toBe("expired");
  expect(
    (
      await call("quotes/" + q.id + "/decision", "POST", {
        version: expired.version,
        state: "accepted",
        reason: "Expired approval",
      })
    ).status,
  ).toBe(400);
  await expect(
    pool().query(
      "INSERT INTO job(id,client_id,title,source_quote_id) VALUES($1,$2,'Invalid conversion',$3)",
      [randomUUID(), client, q.id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
});
it("bounds credit tax components and preserves their values in reversal history", async () => {
  const iid = await invoice([{ ...manual, tax_bps: 500 }]),
    path = "invoices/" + iid + "/adjustments";
  expect(
    (
      await call(path, "POST", {
        kind: "credit",
        amount_minor: 1000,
        tax_minor: 501,
        occurred_on: "2030-01-01",
        reason: "Excess tax component",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(path, "POST", {
        kind: "credit",
        amount_minor: 10500,
        tax_minor: 0,
        occurred_on: "2030-01-01",
        reason: "Excess pretax component",
      })
    ).status,
  ).toBe(409);
  const c = await body<{ id: string }>(path, "POST", {
    kind: "credit",
    amount_minor: 10500,
    tax_minor: 500,
    occurred_on: "2030-01-01",
    reason: "Fictional full value including explicit tax",
  });
  const i = await body<Invoice>("invoices/" + iid);
  expect(i.credit_tax_minor).toBe(500);
  expect(i.status).toBe("settled");
  await body(path + "/" + c.id + "/reverse", "POST", {
    reason: "Incorrect credit",
  });
  expect((await body<Invoice>("invoices/" + iid)).credit_tax_minor).toBe(0);
  const history = await body<{ tax_minor: string }[]>(path);
  expect(history.map((a) => a.tax_minor)).toEqual(["500", "500"]);
});
it("serializes competing credits and refunds so neither exceeds the remaining obligation or cash", async () => {
  const iid = await invoice(),
    path = "invoices/" + iid;
  const credits = await Promise.all([
    call(path + "/adjustments", "POST", {
      kind: "credit",
      amount_minor: 7000,
      occurred_on: "2030-01-01",
      reason: "Competing credit one",
    }),
    call(path + "/adjustments", "POST", {
      kind: "credit",
      amount_minor: 7000,
      occurred_on: "2030-01-01",
      reason: "Competing credit two",
    }),
  ]);
  expect(credits.map((r) => r.status).sort()).toEqual([201, 409]);
  const paid = await invoice();
  await body("invoices/" + paid + "/payments", "POST", {
    amount_minor: 10000,
    method: "cash",
    received_on: "2030-01-01",
  });
  await body("invoices/" + paid + "/adjustments", "POST", {
    kind: "credit",
    amount_minor: 10000,
    occurred_on: "2030-01-01",
    reason: "Fictional full credit",
  });
  const refunds = await Promise.all([
    call("invoices/" + paid + "/adjustments", "POST", {
      kind: "refund",
      amount_minor: 7000,
      occurred_on: "2030-01-01",
      reason: "Competing refund one",
    }),
    call("invoices/" + paid + "/adjustments", "POST", {
      kind: "refund",
      amount_minor: 7000,
      occurred_on: "2030-01-01",
      reason: "Competing refund two",
    }),
  ]);
  expect(refunds.map((r) => r.status).sort()).toEqual([201, 409]);
  expect((await body<Invoice>("invoices/" + paid)).customer_credit_minor).toBe(
    3000,
  );
});
it("derives invoice sent status from a confirmed accepted SMTP result without changing its PDF", async () => {
  await smtp();
  const iid = await invoice(),
    before = Buffer.from(
      await (await call("invoices/" + iid + "/pdf")).arrayBuffer(),
    );
  const result = await body<{ outcome: string }>(
    "invoices/" + iid + "/email",
    "POST",
    {
      recipient: "client@example.invalid",
      subject: "Fictional invoice",
      body: "Test fixture",
    },
  );
  expect(result.outcome).toBe("accepted");
  expect((await body<Invoice>("invoices/" + iid)).status).toBe("sent");
  expect(
    Buffer.from(
      await (await call("invoices/" + iid + "/pdf")).arrayBuffer(),
    ).equals(before),
  ).toBe(true);
});
it("stores ordinary expense receipts privately and refuses unauthenticated downloads", async () => {
  const e = await body<{ id: string }>("expenses", "POST", {
    vendor: "Receipt fixture",
    spent_on: "2030-01-01",
    amount_minor: 10500,
    tax_minor: 500,
    category: "Supplies",
  });
  const upload = await api(
    new Request("http://localhost:3297/api/expenses/" + e.id + "/files", {
      method: "POST",
      headers: {
        host: "localhost:3297",
        origin: "http://localhost:3297",
        cookie,
        "x-csrf-token": csrf,
        "content-type": "application/octet-stream",
        "x-file-name": "fictional-receipt.html",
      },
      body: "<script>Fictional ordinary receipt</script>",
    }),
    ["expenses", e.id, "files"],
  );
  expect(upload.status).toBe(201);
  const file = await upload.json();
  const path = "expenses/" + e.id + "/files/" + file.id;
  const download = await call(path);
  expect(download.headers.get("content-type")).toBe("application/octet-stream");
  expect(download.headers.get("content-disposition")).toContain("attachment");
  expect(await download.text()).toBe(
    "<script>Fictional ordinary receipt</script>",
  );
  const anonymous = await api(
    new Request("http://localhost:3297/api/" + path, {
      headers: { host: "localhost:3297" },
    }),
    path.split("/"),
  );
  expect(anonymous.status).toBe(401);
});
it("allows a replacement quote invoice after discard or void while preserving historical links", async () => {
  const qid = await quote(),
    q = await body<Quote>("quotes/" + qid);
  await body("quotes/" + qid + "/decision", "POST", {
    version: q.version,
    state: "accepted",
    reason: "Fictional accepted replacement fixture",
  });
  const first = await body<{ id: string }>(
      "quotes/" + qid + "/convert",
      "POST",
      { target: "invoice" },
    ),
    draft = await body<Invoice>("invoices/" + first.id);
  await body("invoices/" + first.id, "DELETE", { version: draft.version });
  expect((await body<Quote>("quotes/" + qid)).invoice_id).toBeNull();
  const next = await body<{ id: string }>(
    "quotes/" + qid + "/convert",
    "POST",
    { target: "invoice" },
  );
  expect(next.id).not.toBe(first.id);
  const i = await body<Invoice>("invoices/" + next.id);
  await body("invoices/" + next.id + "/issue", "POST", { version: i.version });
  await body("invoices/" + next.id + "/void", "POST", {
    version: (await body<Invoice>("invoices/" + next.id)).version,
    reason: "Fictional void for replacement",
  });
  expect((await body<Invoice>("invoices/" + next.id)).balance_minor).toBe(0);
  const final = await body<{ id: string }>(
    "quotes/" + qid + "/convert",
    "POST",
    { target: "invoice" },
  );
  expect(final.id).not.toBe(next.id);
  expect((await body<Quote>("quotes/" + qid)).invoice_id).toBe(final.id);
  expect(
    (
      await pool().query("SELECT id FROM invoice WHERE source_quote_id=$1", [
        qid,
      ])
    ).rows,
  ).toHaveLength(3);
});
