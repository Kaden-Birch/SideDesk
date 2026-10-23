// Disposable CI deployment only. Refuses any pre-existing .env.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, writeFile, readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import * as crypt from "../features/vault/crypto";
const exec = promisify(execFile);
try {
  await access(".env");
  throw new Error("Refusing to overwrite an existing .env");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
const dbPassword = randomBytes(32).toString("hex"),
  sessionSecret = randomBytes(32).toString("hex"),
  setup = randomBytes(32).toString("hex"),
  smtpKey = randomBytes(32).toString("hex");
const env = `APP_URL=http://localhost:3000\nAPP_BIND=127.0.0.1\nAPP_PORT=3000\nPOSTGRES_PASSWORD=${dbPassword}\nDATABASE_URL=postgresql://sidedesk:${dbPassword}@postgres:5432/sidedesk\nSESSION_SECRET=${sessionSecret}\nSMTP_ENCRYPTION_KEY=${smtpKey}\nSETUP_TOKEN=${setup}\nFILE_STORAGE_PATH=/data/uploads\nBACKUP_DIR=/data/backups\nNEXT_TELEMETRY_DISABLED=1\n`;
await writeFile(".env", env, { mode: 0o600 });
async function docker(args: string[], quiet = false) {
  const r = await exec("docker", args, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 600000,
  });
  if (!quiet && r.stdout) console.log(r.stdout);
  return r.stdout;
}
await docker(["compose", "up", "--build", "-d"]);
async function ready() {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch("http://localhost:3000/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Docker application did not become ready");
}
await ready();
let cookie = "",
  csrf = "";
async function call<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("http://localhost:3000/api/" + path, {
    method,
    headers: {
      origin: "http://localhost:3000",
      cookie,
      "x-csrf-token": csrf,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  assert.ok(r.ok, `${path} returned ${r.status}`);
  return r.json() as Promise<T>;
}
async function state() {
  const s = await call<{ csrf: string }>("state");
  csrf = s.csrf;
}
await state();
await call("setup", "POST", {
  login_name: "docker-demo-owner",
  password: "fictional-docker-owner-password",
  setup_token: setup,
  name: "Docker fixture",
});
await state();
const client = await call<{ id: string }>("clients", "POST", {
  name: "Docker restore fixture",
  type: "business",
});
// M2: a real job, rate snapshot, full time allocation, issued PDF and partial payment.
const job = await call<{ id: string }>("jobs", "POST", {
  client_id: client.id,
  title: "Docker job fixture",
  hourly_rate_minor: 18000,
});
const activity = await call<{ id: string }>("activities", "POST", {
  client_id: client.id,
  job_id: job.id,
  title: "Docker billable activity",
  billable: true,
  duration_seconds: 1500,
});
const time = await call<{ entries: { id: string }[] }>(
  "activities/" + activity.id,
);
const invoice = await call<{ id: string }>("invoices/from-time", "POST", {
  client_id: client.id,
  source_ids: time.entries.map((e) => e.id),
});
const draft = await call<{ version: number }>("invoices/" + invoice.id);
await call("invoices/" + invoice.id + "/issue", "POST", {
  version: draft.version,
});
await call("invoices/" + invoice.id + "/payments", "POST", {
  amount_minor: 3000,
  method: "e_transfer",
  received_on: "2026-10-23",
  reference: "Fictional Docker receipt",
});
async function pdfBytes() {
  const r = await fetch(
    "http://localhost:3000/api/invoices/" + invoice.id + "/pdf",
    { headers: { cookie } },
  );
  assert.ok(r.ok);
  return Buffer.from(await r.arrayBuffer());
}
const originalPDF = await pdfBytes();
assert.equal(originalPDF.subarray(0, 5).toString(), "%PDF-");
Object.defineProperty(globalThis, "isSecureContext", {
  value: true,
  configurable: true,
});
const recovery = await crypt.recoveryKey(),
  init = await crypt.initialize("fictional-docker-vault-password", recovery);
const { version: _, ...wire } = init.vault;
void _;
await call("vault", "POST", wire);
const cid = randomUUID(),
  secret = {
    ...crypt.emptySecret,
    password: "FICTIONAL_RESTORED_SECRET_82374",
  },
  payload = await crypt.encrypt(init.vault, init.vmk, cid, client.id, secret);
await call("credentials", "POST", {
  id: cid,
  client_id: client.id,
  title: "Docker fixture",
  payload,
  version: 0,
});
init.vmk.fill(0);
const fileResponse = await fetch(
  `http://localhost:3000/api/jobs/${job.id}/files`,
  {
    method: "POST",
    headers: {
      cookie,
      origin: "http://localhost:3000",
      "x-csrf-token": csrf,
      "content-type": "application/octet-stream",
      "x-file-name": "restore-fixture.txt",
    },
    body: "fictional upload fixture",
  },
);
assert.equal(fileResponse.status, 201);
const jobFile = (await fileResponse.json()) as { id: string };

// M3: frozen quote conversion, vendor cost versus recovery, mileage/time,
// credits/refunds and a separately encrypted SMTP password survive restore.
const quote = await call<{ id: string }>("quotes", "POST", {
  client_id: client.id,
  issue_date: "2030-01-01",
  expiry_date: "2030-01-31",
  lines: [
    {
      kind: "manual",
      description: "Fictional Docker quoted service",
      quantity: "1.125",
      unit_minor: 10000,
    },
  ],
});
let q = await call<{ version: number }>("quotes/" + quote.id);
await call("quotes/" + quote.id + "/publish", "POST", { version: q.version });
q = await call("quotes/" + quote.id);
await call("quotes/" + quote.id + "/decision", "POST", {
  version: q.version,
  state: "accepted",
  reason: "Fictional Docker approval",
});
const quoteInvoice = await call<{ id: string }>(
  "quotes/" + quote.id + "/convert",
  "POST",
  { target: "invoice" },
);
const quotePDFResponse = await fetch(
  "http://localhost:3000/api/quotes/" + quote.id + "/pdf",
  { headers: { cookie } },
);
assert.ok(quotePDFResponse.ok);
const originalQuotePDF = Buffer.from(await quotePDFResponse.arrayBuffer());
const expense = await call<{ id: string }>("expenses", "POST", {
  vendor: "Fictional Docker vendor",
  spent_on: "2030-01-01",
  amount_minor: 10500,
  tax_minor: 500,
  category: "Supplies",
  description: "Docker expense recovery",
  client_id: client.id,
  billable: true,
  recovery_minor: 12000,
});
const trip = await call<{ id: string }>("trips", "POST", {
  travelled_on: "2030-01-01",
  purpose: "Fictional Docker visit",
  distance_milli_km: 10125,
  duration_seconds: 720,
  mileage_rate_minor: 70,
  time_rate_minor: 10000,
  rounding_minutes: 15,
  client_id: client.id,
  billable_mileage: true,
  billable_time: true,
});
const charges =
  await call<
    { id: string; expense_id: string | null; trip_id: string | null }[]
  >("unbilled-charges");
const chargeInvoice = await call<{ id: string }>(
  "invoices/from-charges",
  "POST",
  {
    client_id: client.id,
    charge_ids: charges
      .filter((c) => c.expense_id === expense.id || c.trip_id === trip.id)
      .map((c) => c.id),
  },
);
assert.equal(
  (await call<{ total_minor: number }>("invoices/" + chargeInvoice.id))
    .total_minor,
  15209,
);
const receiptResponse = await fetch(
  `http://localhost:3000/api/expenses/${expense.id}/files`,
  {
    method: "POST",
    headers: {
      cookie,
      origin: "http://localhost:3000",
      "x-csrf-token": csrf,
      "content-type": "application/octet-stream",
      "x-file-name": "fictional-receipt.txt",
    },
    body: "Fictional M3 receipt total CAD 105.00",
  },
);
assert.equal(receiptResponse.status, 201);
const receiptFile = (await receiptResponse.json()) as { id: string };
await call("invoices/" + invoice.id + "/adjustments", "POST", {
  kind: "credit",
  amount_minor: 7000,
  occurred_on: "2030-01-01",
  reason: "Fictional Docker credit",
});
await call("invoices/" + invoice.id + "/adjustments", "POST", {
  kind: "refund",
  amount_minor: 1000,
  occurred_on: "2030-01-01",
  reason: "Fictional external refund recorded",
  method: "cash",
});
await call("smtp", "PUT", {
  version: 0,
  host: "smtp.example.invalid",
  port: 465,
  security: "tls",
  username: "fixture-owner",
  password: "FICTIONAL_DOCKER_SMTP_PASSWORD",
  from_address: "owner@example.invalid",
  from_name: "Docker fixture",
});
assert.equal(
  JSON.stringify(await call("smtp")).includes("FICTIONAL_DOCKER_SMTP_PASSWORD"),
  false,
);
await call("backup", "POST", {});
const backupDir = (
  await docker(
    [
      "compose",
      "exec",
      "-T",
      "app",
      "node",
      "-e",
      "const f=require('fs');process.stdout.write('/data/backups/'+f.readdirSync('/data/backups').filter(x=>x.startsWith('sidedesk-')).sort().at(-1))",
    ],
    true,
  )
).trim();
assert.match(backupDir, /^\/data\/backups\/sidedesk-[0-9]+-[a-f0-9]+$/);
// Verify the manifest inside the private backup volume before restoring.
await docker([
  "compose",
  "exec",
  "-T",
  "app",
  "node",
  "-e",
  `const f=require('fs'),c=require('crypto'),p=require('path'),d=process.argv[1],m=JSON.parse(f.readFileSync(p.join(d,'manifest.json')));for(const [k,v]of Object.entries(m.sha256)){if(k.includes('..')||p.isAbsolute(k))throw Error('unsafe path');if(c.createHash('sha256').update(f.readFileSync(p.join(d,k))).digest('hex')!==v)throw Error('checksum mismatch');}`,
  backupDir,
]);
await docker([
  "compose",
  "exec",
  "-T",
  "postgres",
  "createdb",
  "-U",
  "sidedesk",
  "restored",
]);
await new Promise<void>((resolve, reject) => {
  const source = spawn("docker", [
    "compose",
    "exec",
    "-T",
    "app",
    "cat",
    backupDir + "/database.dump",
  ]);
  const target = spawn("docker", [
    "compose",
    "exec",
    "-T",
    "postgres",
    "pg_restore",
    "-U",
    "sidedesk",
    "-d",
    "restored",
    "--no-owner",
    "--exit-on-error",
  ]);
  source.stdout.pipe(target.stdin);
  source.stderr.pipe(process.stderr);
  target.stderr.pipe(process.stderr);
  source.on("error", reject);
  target.on("error", reject);
  let sourceCode: number | null = null,
    targetCode: number | null = null;
  const finish = () => {
    if (sourceCode !== null && targetCode !== null) {
      if (sourceCode === 0 && targetCode === 0) resolve();
      else reject(new Error("restore failed"));
    }
  };
  source.on("exit", (code) => {
    sourceCode = code;
    finish();
  });
  target.on("exit", (code) => {
    targetCode = code;
    finish();
  });
});
await docker([
  "compose",
  "exec",
  "-T",
  "postgres",
  "psql",
  "-U",
  "sidedesk",
  "-d",
  "restored",
  "-c",
  "UPDATE session SET revoked_at=now();",
]);
await docker(["compose", "stop", "app"]);
await docker([
  "compose",
  "run",
  "--rm",
  "--no-deps",
  "app",
  "node",
  "-e",
  `const f=require('fs');for(const x of f.readdirSync('/data/uploads'))f.rmSync('/data/uploads/'+x,{recursive:true,force:true});f.cpSync(process.argv[1]+'/uploads','/data/uploads',{recursive:true});`,
  backupDir,
]);
await writeFile(
  ".env",
  (await readFile(".env", "utf8")).replace(
    "@postgres:5432/sidedesk",
    "@postgres:5432/restored",
  ),
  { mode: 0o600 },
);
await docker(["compose", "up", "-d", "--force-recreate", "app"]);
await ready();
cookie = "";
await state();
await call("login", "POST", {
  login_name: "docker-demo-owner",
  password: "fictional-docker-owner-password",
});
await state();
const v = await call<crypt.Vault>("vault"),
  key = await crypt.unwrap(v, recovery, true);
const record = await call<{
  id: string;
  client_id: string;
  payload: crypt.Ciphertext;
}>("credentials/" + cid);
assert.deepEqual(
  await crypt.decrypt(v, key, record.id, record.client_id, record.payload),
  secret,
);
key.fill(0);
assert.equal(
  (await call<{ name: string }[]>("clients"))[0].name,
  "Docker restore fixture",
);
const restoredInvoice = await call<{
  total_minor: number;
  balance_minor: number;
}>("invoices/" + invoice.id);
assert.equal(restoredInvoice.total_minor, 9000);
assert.equal(restoredInvoice.balance_minor, 0);
assert.equal((await pdfBytes()).equals(originalPDF), true);
assert.equal(
  (await call<{ id: string }[]>("unbilled")).some(
    (e) => e.id === time.entries[0].id,
  ),
  false,
);
assert.equal((await call<{ id: string }>("jobs/" + job.id)).id, job.id);
const restoredFile = await fetch(
  `http://localhost:3000/api/jobs/${job.id}/files/${jobFile.id}`,
  { headers: { cookie } },
);
assert.equal(restoredFile.status, 200);
assert.equal(await restoredFile.text(), "fictional upload fixture");

const restoredQuote = await call<{ state: string; invoice_id: string }>(
  "quotes/" + quote.id,
);
assert.equal(restoredQuote.state, "accepted");
assert.equal(restoredQuote.invoice_id, quoteInvoice.id);
assert.equal(
  (await call<{ total_minor: number }>("invoices/" + quoteInvoice.id))
    .total_minor,
  11250,
);
const restoredQuoteResponse = await fetch(
  "http://localhost:3000/api/quotes/" + quote.id + "/pdf",
  { headers: { cookie } },
);
assert.ok(restoredQuoteResponse.ok);
assert.equal(
  Buffer.from(await restoredQuoteResponse.arrayBuffer()).equals(
    originalQuotePDF,
  ),
  true,
);
assert.equal((await call<unknown[]>("unbilled-charges")).length, 0);
const restoredReceipt = await fetch(
  `http://localhost:3000/api/expenses/${expense.id}/files/${receiptFile.id}`,
  { headers: { cookie } },
);
assert.ok(restoredReceipt.ok);
assert.equal(
  await restoredReceipt.text(),
  "Fictional M3 receipt total CAD 105.00",
);
const financial = await call<{
  received_minor: number;
  credit_minor: number;
  customer_credit_minor: number;
}>("invoices/" + invoice.id);
assert.equal(financial.received_minor, 2000);
assert.equal(financial.credit_minor, 7000);
assert.equal(financial.customer_credit_minor, 0);
const smtp = await call<{ version: number; has_password: boolean }>("smtp");
assert.equal(smtp.has_password, true);
// Saving without a replacement password authenticates/decrypts the restored
// envelope with the preserved deployment key, without contacting any host.
await call("smtp", "PUT", {
  version: smtp.version,
  host: "smtp.example.invalid",
  port: 465,
  security: "tls",
  username: "fixture-owner",
  from_address: "owner@example.invalid",
  from_name: "Restored fixture",
});
console.log(
  "Docker fresh build, migration, jobs, invoice/PDF/payment allocations, quotes/conversion, expense receipts, travel charges, credits/refunds, encrypted SMTP settings, consistent backup, fresh database/file restore, immutable PDFs and vault recovery passed.",
);
