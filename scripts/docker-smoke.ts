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
  setup = randomBytes(32).toString("hex");
const env = `APP_URL=http://localhost:3000\nAPP_BIND=127.0.0.1\nAPP_PORT=3000\nPOSTGRES_PASSWORD=${dbPassword}\nDATABASE_URL=postgresql://sidedesk:${dbPassword}@postgres:5432/sidedesk\nSESSION_SECRET=${sessionSecret}\nSETUP_TOKEN=${setup}\nFILE_STORAGE_PATH=/data/uploads\nBACKUP_DIR=/data/backups\nNEXT_TELEMETRY_DISABLED=1\n`;
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
assert.equal(restoredInvoice.balance_minor, 6000);
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
console.log(
  "Docker fresh build, migration, jobs, invoice/PDF/payment allocations, consistent backup, fresh database/file restore, immutable PDF and vault recovery passed.",
);
