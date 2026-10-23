import { beforeAll, afterAll, it, expect, vi } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { api } from "../lib/api";
import { pool } from "../lib/db";
import { migrate } from "../scripts/migrate";
import { HttpError } from "../lib/auth";
import * as pdf from "../features/billing/pdf";
import type { Invoice, Source, DraftInput } from "../features/billing/model";
let pg: EmbeddedPostgres,
  dir: string,
  cookie = "",
  csrf = "",
  client = "",
  job = "",
  firstInvoice = "",
  groupInvoice = "",
  firstSource = "";
const owner = {
  login_name: "billing-demo-owner",
  password: "fictional-billing-login-password",
  setup_token: "billing-test-bootstrap-secret-1234567890123456",
  name: "Fictional IT Studio",
  hourly_rate_minor: 12000,
};
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  key: string = randomUUID(),
) {
  return api(
    new Request("http://localhost:3299/api/" + path, {
      method,
      headers: {
        host: "localhost:3299",
        origin: "http://localhost:3299",
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrf,
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
  payload?: unknown,
  key?: string,
): Promise<T> {
  const r = await call(path, method, payload, key);
  expect(r.status, `${method} ${path}: ${r.status}`).toBeLessThan(300);
  return r.json();
}
async function state() {
  const r = await call("state");
  const c = r.headers.get("set-cookie");
  if (c) cookie = c.split(";")[0];
  csrf = (await r.json()).csrf;
}
async function profile(scope: "entry" | "group") {
  const s = await body<{ settings: { version: number } }>("state");
  return body("billing-profile", "PUT", {
    version: s.settings.version,
    legal_name: "Fictional IT Studio",
    address: "100 Fictional Street\nEdmonton, AB",
    email: "demo@example.invalid",
    phone: "",
    registration_number: "",
    payment_instructions: "Fictional e-transfer instructions",
    invoice_terms: "Payment within 30 days",
    rounding_scope: scope,
    accent_color: "#365f9b",
  });
}
async function activity(
  title: string,
  seconds: number,
  extras: Record<string, unknown> = {},
) {
  return body<{ id: string }>("activities", "POST", {
    client_id: client,
    title,
    billable: true,
    duration_seconds: seconds,
    ...extras,
  });
}
async function entryIds(aid: string) {
  return (await body<{ entries: Source[] }>("activities/" + aid)).entries.map(
    (e) => e.id,
  );
}
async function manualDraft(lines: DraftInput["lines"], clientId = client) {
  return body<{ id: string }>("invoices", "POST", {
    client_id: clientId,
    issue_date: "2030-01-01",
    due_date: "2030-01-31",
    paper: "Letter",
    lines,
  });
}
const manualLine = {
  kind: "manual" as const,
  description: "Fictional service",
  quantity: "1",
  unit_minor: 10000,
  discount_bps: 0,
  tax_bps: 0,
  tax_label: "Tax",
};
async function issue(id: string, key?: string) {
  const i = await body<Invoice>("invoices/" + id);
  return body<{ number: string }>(
    "invoices/" + id + "/issue",
    "POST",
    { version: i.version },
    key,
  );
}
beforeAll(async () => {
  dir = await mkdtemp(tmpdir() + "/sidedesk-billing-");
  pg = new EmbeddedPostgres({
    databaseDir: dir + "/db",
    user: "test",
    password: "test",
    port: 55434,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  await pg.initialise();
  await pg.start();
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:55434/postgres";
  process.env.APP_URL = "http://localhost:3299";
  process.env.FILE_STORAGE_PATH = dir + "/uploads";
  process.env.SESSION_SECRET = "billing-test-session-secret-1234567890123456";
  process.env.SETUP_TOKEN = owner.setup_token;
  await migrate();
  await state();
  const r = await call("setup", "POST", owner);
  expect(r.status).toBe(200);
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  await state();
  client = (
    await body<{ id: string }>("clients", "POST", {
      name: "Fictional billing client",
      type: "business",
      hourly_rate_minor: 15000,
    })
  ).id;
});
afterAll(async () => {
  await pool().end();
  await pg?.stop();
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
it("supports structured jobs and the business/client/job/entry rate hierarchy without rewriting history", async () => {
  const businessClient = await body<{ id: string }>("clients", "POST", {
    name: "Business rate fixture",
    type: "person",
  });
  const a = await body<{ id: string }>("activities", "POST", {
    client_id: businessClient.id,
    title: "Business default",
    billable: true,
    duration_seconds: 60,
  });
  const b = (await body<{ entries: Source[] }>("activities/" + a.id))
    .entries[0];
  expect(b.rate_minor).toBe("12000");
  expect(b.rate_source).toBe("business");
  const early = await activity("Before job assignment", 1500);
  firstSource = (await entryIds(early.id))[0];
  const before = (await body<{ entries: Source[] }>("activities/" + early.id))
    .entries[0];
  expect(before.rate_minor).toBe("15000");
  expect(before.job_id).toBeNull();
  job = (
    await body<{ id: string }>("jobs", "POST", {
      client_id: client,
      title: "Fictional migration job",
      description: "Defined scope",
      status: "in_progress",
      priority: "high",
      due_date: "2030-02-01",
      hourly_rate_minor: 18000,
    })
  ).id;
  const old = await body<{
    version: number;
    title: string;
    activity_notes: string;
    billable: boolean;
    status: string;
  }>("activities/" + early.id);
  await body("activities/" + early.id, "PUT", {
    title: old.title,
    notes: old.activity_notes,
    billable: old.billable,
    status: old.status,
    version: old.version,
    job_id: job,
  });
  const historical = (
    await body<{ entries: Source[] }>("activities/" + early.id)
  ).entries[0];
  expect(historical.rate_minor).toBe("15000");
  expect(historical.job_id).toBeNull();
  const later = await body<Source>("time-entries", "POST", {
    activity_id: early.id,
    duration_seconds: 300,
  });
  expect(later.rate_minor).toBe("18000");
  expect(later.rate_source).toBe("job");
  expect(later.job_id).toBe(job);
  const override = await body<Source>("time-entries", "POST", {
    activity_id: early.id,
    duration_seconds: 300,
    rate_minor: 20000,
  });
  expect(override.rate_minor).toBe("20000");
  expect(override.rate_source).toBe("entry");
  expect(
    (
      await call("activities", "POST", {
        client_id: businessClient.id,
        job_id: job,
        title: "Wrong client",
        billable: true,
      })
    ).status,
  ).toBe(400);
  await body("notes", "POST", {
    client_id: null,
    activity_id: null,
    job_id: job,
    body: "**Job context**",
  });
  const j = await body<{ version: number }>("jobs/" + job);
  await body("jobs/" + job, "PUT", {
    client_id: client,
    title: "Fictional migration job",
    status: "completed",
    hourly_rate_minor: 19000,
    version: j.version,
  });
  expect((await body<unknown[]>("invoices")).length).toBe(0);
});
it("stores job attachments privately with authenticated, non-executable, checksummed downloads", async () => {
  const upload = await api(
    new Request(`http://localhost:3299/api/jobs/${job}/files`, {
      method: "POST",
      headers: {
        host: "localhost:3299",
        origin: "http://localhost:3299",
        cookie,
        "x-csrf-token": csrf,
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("fictional-handover.html"),
      },
      body: "<script>Fictional attachment; never inline</script>",
    }),
    ["jobs", job, "files"],
  );
  expect(upload.status).toBe(201);
  const file = await upload.json();
  const response = await call(`jobs/${job}/files/${file.id}`);
  expect(response.headers.get("content-type")).toBe("application/octet-stream");
  expect(response.headers.get("content-disposition")).toContain("attachment;");
  expect(await response.text()).toBe(
    "<script>Fictional attachment; never inline</script>",
  );
  expect(
    (
      await api(
        new Request(`http://localhost:3299/api/jobs/${job}/files/${file.id}`, {
          headers: { host: "localhost:3299" },
        }),
        ["jobs", job, "files", file.id],
      )
    ).status,
  ).toBe(401);
  expect((await call(`jobs/${job}/files/../../secret`)).status).toBe(404);
  await body(`jobs/${job}/files/${file.id}`, "DELETE", {});
  expect((await call(`jobs/${job}/files/${file.id}`)).status).toBe(404);
});
it("rounds per entry and per compatible invoice group using integer seconds", async () => {
  await profile("entry");
  const a = await activity("Entry rounding", 300);
  await body("time-entries", "POST", {
    activity_id: a.id,
    duration_seconds: 300,
  });
  const ids = await entryIds(a.id);
  const result = await body<{ id: string }>("invoices/from-time", "POST", {
    client_id: client,
    source_ids: ids,
  });
  firstInvoice = result.id;
  let i = await body<Invoice>("invoices/" + result.id);
  expect(i.lines[0].original_seconds).toBe(600);
  expect(i.lines[0].billable_seconds).toBe(1800);
  expect(i.total_minor).toBe(7500);
  await profile("group");
  const g = await activity("Group rounding", 300);
  await body("time-entries", "POST", {
    activity_id: g.id,
    duration_seconds: 300,
  });
  groupInvoice = (
    await body<{ id: string }>("invoices/from-time", "POST", {
      client_id: client,
      source_ids: await entryIds(g.id),
    })
  ).id;
  i = await body<Invoice>("invoices/" + groupInvoice);
  expect(i.lines[0].original_seconds).toBe(600);
  expect(i.lines[0].billable_seconds).toBe(900);
  expect(i.total_minor).toBe(3750);
  await profile("entry");
});
it("reserves each whole source once under concurrent draft creation and supports idempotent retries", async () => {
  const a = await activity("Concurrent source", 1500),
    ids = await entryIds(a.id),
    input = { client_id: client, source_ids: ids };
  const results = await Promise.all([
    call("invoices/from-time", "POST", input),
    call("invoices/from-time", "POST", input),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const b = await activity("Idempotent source", 300),
    key = randomUUID(),
    data = { client_id: client, source_ids: await entryIds(b.id) };
  const one = await body<{ id: string }>(
      "invoices/from-time",
      "POST",
      data,
      key,
    ),
    two = await body<{ id: string }>("invoices/from-time", "POST", data, key);
  expect(one.id).toBe(two.id);
  expect(
    (
      await call("invoices/from-time", "POST", {
        client_id: client,
        source_ids: [firstSource, firstSource],
      })
    ).status,
  ).toBe(400);
  const reserved = (await body<Invoice>("invoices/" + one.id)).lines[0]
    .source_snapshot[0];
  expect(
    (
      await call("time-entries/" + reserved.id, "PUT", {
        version: reserved.version,
        rate_minor: 1,
        billable: true,
        reason: "Should be blocked",
      })
    ).status,
  ).toBe(409);
  const allocatedInvoice = await body<Invoice>("invoices/" + one.id);
  await expect(
    pool().query(
      "INSERT INTO invoice_allocation(id,invoice_id,line_id,time_entry_id,allocated_seconds) VALUES($1,$2,$3,$4,1)",
      [randomUUID(), one.id, allocatedInvoice.lines[0].id, reserved.id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool().query("UPDATE time_entry SET duration_seconds=1 WHERE id=$1", [
      reserved.id,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("keeps disabled taxes at zero and refuses a nonzero tax without enabling taxes", async () => {
  const d = await manualDraft([manualLine]);
  expect((await body<Invoice>("invoices/" + d.id)).tax_minor).toBe(0);
  expect(
    (
      await call("invoices", "POST", {
        client_id: client,
        issue_date: "2030-01-01",
        due_date: "2030-01-31",
        lines: [{ ...manualLine, tax_bps: 500 }],
      })
    ).status,
  ).toBe(400);
});
it("calculates discounts/taxes with deterministic decimal arithmetic and snapshots line totals", async () => {
  const s = await body<{ settings: Record<string, unknown> }>("state"),
    b = s.settings;
  await body("settings", "PUT", {
    name: b.name,
    timezone: b.timezone,
    hourly_rate_minor: Number(b.hourly_rate_minor),
    rounding_minutes: b.rounding_minutes,
    invoice_prefix: b.invoice_prefix,
    tax_enabled: true,
    vault_idle_minutes: b.vault_idle_minutes,
    https_dismissed: b.https_dismissed,
    version: b.version,
  });
  const d = await manualDraft([
    {
      ...manualLine,
      quantity: "1.125",
      unit_minor: 1999,
      discount_bps: 750,
      tax_bps: 500,
      tax_label: "Configured tax",
    },
    {
      ...manualLine,
      quantity: "2",
      unit_minor: 12345,
      discount_bps: 1000,
      tax_bps: 1200,
      tax_label: "Combined configured tax",
    },
  ]);
  const i = await body<Invoice>("invoices/" + d.id);
  expect(i.lines.map((l) => l.total_minor)).toEqual([2184, 24888]);
  expect(i.total_minor).toBe(27072);
  expect(i.lines[0].discount_minor).toBe(169);
  expect(i.lines[1].tax_minor).toBe(2667);
  expect(
    (
      await call("invoices", "POST", {
        client_id: client,
        issue_date: "2030-02-30",
        due_date: "2030-03-30",
        lines: [manualLine],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("invoices", "POST", {
        client_id: client,
        issue_date: "2030-01-01",
        due_date: "2030-01-31",
        lines: [{ ...manualLine, tax_bps: -1 }],
      })
    ).status,
  ).toBe(400);
});
it("assigns unique sequential numbers under simultaneous issuance and freezes headers, lines and PDF bytes", async () => {
  const results = await Promise.all([issue(firstInvoice), issue(groupInvoice)]);
  expect(new Set(results.map((r) => r.number)).size).toBe(2);
  expect(results.map((r) => r.number).sort()).toEqual([
    "INV-000001",
    "INV-000002",
  ]);
  const i = await body<Invoice>("invoices/" + firstInvoice),
    before = Buffer.from(
      await (await call("invoices/" + firstInvoice + "/pdf")).arrayBuffer(),
    );
  expect(before.subarray(0, 5).toString()).toBe("%PDF-");
  expect(createHash("sha256").update(before).digest("hex")).toBe(i.pdf_sha256);
  expect(
    (
      await call("invoices/" + firstInvoice, "PUT", {
        client_id: client,
        issue_date: "2030-01-01",
        due_date: "2030-01-31",
        lines: [manualLine],
        version: i.version,
      })
    ).status,
  ).toBe(409);
  await expect(
    pool().query(
      "UPDATE invoice SET total_minor=0,subtotal_minor=0 WHERE id=$1",
      [i.id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool().query(
      "UPDATE invoice_line SET description='Changed' WHERE invoice_id=$1",
      [i.id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool().query("DELETE FROM invoice WHERE id=$1", [i.id]),
  ).rejects.toMatchObject({ code: "23514" });
  const clientBefore = await body<Record<string, unknown>>("clients/" + client);
  expect(clientBefore).not.toHaveProperty("pdf_bytes");
  expect(clientBefore).not.toHaveProperty("snapshot");
});
it("records partial/full payments and append-only corrections without changing issued totals or PDFs", async () => {
  const initial = await body<Invoice>("invoices/" + firstInvoice),
    pdfBefore = Buffer.from(
      await (await call("invoices/" + firstInvoice + "/pdf")).arrayBuffer(),
    );
  const amount = 1000,
    key = randomUUID(),
    payload = {
      amount_minor: amount,
      method: "e_transfer",
      received_on: "2030-01-10",
      reference: "Fictional receipt",
      note: "",
    };
  const p = await body<{ id: string }>(
    "invoices/" + firstInvoice + "/payments",
    "POST",
    payload,
    key,
  );
  expect(
    (
      await body<{ id: string }>(
        "invoices/" + firstInvoice + "/payments",
        "POST",
        payload,
        key,
      )
    ).id,
  ).toBe(p.id);
  let i = await body<Invoice>("invoices/" + firstInvoice);
  expect(i.status).toBe("partially_paid");
  expect(i.balance_minor).toBe(initial.total_minor - amount);
  expect(i.total_minor).toBe(initial.total_minor);
  expect(
    (
      await call("invoices/" + firstInvoice + "/payments", "POST", {
        ...payload,
        amount_minor: i.balance_minor + 1,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("invoices/" + firstInvoice + "/void", "POST", {
        version: i.version,
        reason: "Not allowed while paid",
      })
    ).status,
  ).toBe(400);
  await expect(
    pool().query("DELETE FROM payment WHERE id=$1", [p.id]),
  ).rejects.toMatchObject({ code: "23514" });
  await body(
    "invoices/" + firstInvoice + "/payments/" + p.id + "/reverse",
    "POST",
    { reason: "Correct an erroneously entered receipt" },
  );
  i = await body<Invoice>("invoices/" + firstInvoice);
  expect(i.received_minor).toBe(0);
  expect(i.payments).toHaveLength(2);
  expect(
    (
      await call(
        "invoices/" + firstInvoice + "/payments/" + p.id + "/reverse",
        "POST",
        { reason: "Duplicate" },
      )
    ).status,
  ).toBe(409);
  await body("invoices/" + firstInvoice + "/payments", "POST", {
    ...payload,
    amount_minor: i.balance_minor,
  });
  i = await body<Invoice>("invoices/" + firstInvoice);
  expect(i.status).toBe("paid");
  expect(i.balance_minor).toBe(0);
  expect(i.total_minor).toBe(initial.total_minor);
  const pdfAfter = Buffer.from(
    await (await call("invoices/" + firstInvoice + "/pdf")).arrayBuffer(),
  );
  expect(pdfAfter.equals(pdfBefore)).toBe(true);
});
it("serializes competing receipts so balance cannot be overpaid", async () => {
  const d = await manualDraft([manualLine]);
  await issue(d.id);
  const p = { amount_minor: 6000, method: "cash", received_on: "2030-01-10" };
  const r = await Promise.all([
    call("invoices/" + d.id + "/payments", "POST", p),
    call("invoices/" + d.id + "/payments", "POST", p),
  ]);
  expect(r.map((x) => x.status).sort()).toEqual([201, 400]);
  expect((await body<Invoice>("invoices/" + d.id)).balance_minor).toBe(4000);
});
it("rolls back failed PDF generation and numbering, then retries issuance idempotently", async () => {
  const d = await manualDraft([manualLine]),
    i = await body<Invoice>("invoices/" + d.id),
    counter = (await pool().query("SELECT next_number FROM invoice_counter"))
      .rows[0].next_number;
  const key = randomUUID();
  vi.spyOn(pdf, "renderInvoicePDF").mockRejectedValueOnce(
    new HttpError(503, "PDF generation failed; not issued"),
  );
  const failed = await call(
    "invoices/" + d.id + "/issue",
    "POST",
    { version: i.version },
    key,
  );
  expect(failed.status).toBe(503);
  expect((await body<Invoice>("invoices/" + d.id)).state).toBe("draft");
  expect(
    (await pool().query("SELECT next_number FROM invoice_counter")).rows[0]
      .next_number,
  ).toBe(counter);
  const one = await body<{ number: string }>(
    "invoices/" + d.id + "/issue",
    "POST",
    { version: i.version },
    key,
  );
  const two = await body<{ number: string }>(
    "invoices/" + d.id + "/issue",
    "POST",
    { version: i.version },
    key,
  );
  expect(one.number).toBe(two.number);
  vi.restoreAllMocks();
});
it("voids an unpaid invoice without rewriting its PDF and releases sources for rebilling", async () => {
  const i = await body<Invoice>("invoices/" + groupInvoice),
    before = Buffer.from(
      await (await call("invoices/" + groupInvoice + "/pdf")).arrayBuffer(),
    );
  const ids = i.lines.flatMap((l) => l.source_snapshot.map((s) => s.id));
  await body("invoices/" + groupInvoice + "/void", "POST", {
    version: i.version,
    reason: "Fictional scope cancelled",
  });
  expect((await body<Invoice>("invoices/" + groupInvoice)).state).toBe("void");
  expect(
    Buffer.from(
      await (await call("invoices/" + groupInvoice + "/pdf")).arrayBuffer(),
    ).equals(before),
  ).toBe(true);
  const queue = await body<Source[]>("unbilled");
  expect(ids.every((id) => queue.some((s) => s.id === id))).toBe(true);
  const fresh = await body<{ id: string }>("invoices/from-time", "POST", {
    client_id: client,
    source_ids: ids,
  });
  expect(fresh.id).not.toBe(groupInvoice);
});
it("discarding a draft releases reservations and time-rate reviews are versioned and audited", async () => {
  const a = await activity("Discard/review fixture", 60),
    ids = await entryIds(a.id);
  const d = await body<{ id: string }>("invoices/from-time", "POST", {
      client_id: client,
      source_ids: ids,
    }),
    i = await body<Invoice>("invoices/" + d.id);
  await body("invoices/" + d.id, "DELETE", { version: i.version });
  expect((await call("invoices/" + d.id)).status).toBe(404);
  const e = (await body<Source[]>("unbilled")).find((e) => e.id === ids[0])!;
  await body("time-entries/" + e.id, "PUT", {
    version: e.version,
    rate_minor: 22000,
    billable: true,
    reason: "Agreed explicit entry override",
  });
  expect(
    (
      await pool().query(
        "SELECT reason FROM time_entry_revision WHERE time_entry_id=$1",
        [e.id],
      )
    ).rows[0].reason,
  ).toBe("Agreed explicit entry override");
  expect(
    (
      await call("time-entries/" + e.id, "PUT", {
        version: e.version,
        rate_minor: 1,
        billable: true,
        reason: "Stale",
      })
    ).status,
  ).toBe(409);
});
it("prevents archiving a client while billable work or financial balances need attention", async () => {
  expect((await call("clients/" + client, "DELETE")).status).toBe(400);
  const clean = await body<{ id: string }>("clients", "POST", {
    name: "Fictional archivable client",
    type: "person",
  });
  expect((await call("clients/" + clean.id, "DELETE")).status).toBe(200);
});
