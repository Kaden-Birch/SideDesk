import { randomBytes, randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import type { PoolClient } from "pg";
import { config } from "./config";
import { pool, transaction } from "./db";
import {
  HttpError,
  requireValue,
  originCheck,
  csrfCheck,
  csrf,
  cookie,
  preauthCookie,
  getSession,
  newSession,
  sessionCookie,
  passwordHash,
  passwordValid,
  equal,
  throttle,
  digest,
} from "./auth";
import {
  id,
  text,
  rate,
  settingsInput,
  clientInput,
  activityInput,
  vaultCreate,
  envelope,
  credentialInput,
  auditType,
} from "./validation";
const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
const audit = async (db: PoolClient, type: string, outcome = "success") => {
  await db.query(
    "INSERT INTO general_audit(id,type,outcome) VALUES($1,$2,$3)",
    [randomUUID(), type, outcome],
  );
};
async function recordAudit(
  db: PoolClient,
  type: string,
  credentialId: string | null = null,
  provenance = "server",
) {
  await db.query(
    "INSERT INTO credential_audit_event(id,credential_id,type,provenance) VALUES($1,$2,$3,$4)",
    [randomUUID(), credentialId, type, provenance],
  );
}
async function effective(db: PoolClient, activityId: string) {
  const r = await db.query(
    "SELECT a.billable,COALESCE(c.hourly_rate_minor,b.hourly_rate_minor) AS rate_minor,b.rounding_minutes FROM activity a JOIN client c ON c.id=a.client_id CROSS JOIN business_settings b WHERE a.id=$1",
    [activityId],
  );
  requireValue(r.rowCount, 404, "Activity not found");
  return r.rows[0];
}
async function read(req: Request) {
  requireValue(
    req.headers.get("content-type")?.startsWith("application/json"),
    415,
    "Use JSON",
  );
  const reader = req.body?.getReader();
  requireValue(reader, 400, "Missing body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > 300000) {
      await reader.cancel();
      throw new HttpError(413, "Request too large");
    }
    chunks.push(r.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
async function once(
  db: PoolClient,
  key: string,
  operation: string,
  input: unknown,
  fn: () => Promise<unknown>,
) {
  const h = digest(JSON.stringify(input));
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
  const prior = (
    await db.query("SELECT * FROM idempotency WHERE key=$1", [key])
  ).rows[0];
  if (prior) {
    requireValue(
      prior.operation === operation && prior.request_hash === h,
      409,
      "Request key already used",
    );
    return prior.response;
  }
  const result = await fn();
  await db.query(
    "INSERT INTO idempotency(key,operation,request_hash,response) VALUES($1,$2,$3,$4)",
    [key, operation, h, JSON.stringify(result)],
  );
  return result;
}
async function handle(req: Request, path: string[]) {
  originCheck(req);
  const method = req.method,
    route = path.join("/");
  if (route === "health" && method === "GET") {
    await pool().query("SELECT 1");
    return json({ ok: true });
  }
  const sess = await getSession(req);
  if (route === "state" && method === "GET") {
    const initialized = Boolean(
      (await pool().query("SELECT id FROM owner LIMIT 1")).rowCount,
    );
    if (!sess) {
      const pre =
        cookie(req, "sidedesk_preauth") || randomBytes(32).toString("hex");
      return json({ initialized, authenticated: false, csrf: csrf(pre) }, 200, {
        "Set-Cookie": preauthCookie(pre),
      });
    }
    const s = (await pool().query("SELECT * FROM business_settings")).rows[0];
    return json({
      initialized,
      authenticated: true,
      csrf: csrf(sess.token),
      settings: s,
      vault_initialized: Boolean(
        (await pool().query("SELECT id FROM vault")).rowCount,
      ),
    });
  }
  if ((route === "setup" || route === "login") && method === "POST") {
    csrfCheck(req, cookie(req, "sidedesk_preauth"));
    const body = await read(req);
    const p = z
      .object({
        login_name: text(80),
        password: z
          .string()
          .min(route === "setup" ? 14 : 1)
          .max(256),
        setup_token: z.string().max(256).optional(),
        name: text().optional(),
        timezone: text(80).optional(),
        hourly_rate_minor: rate.optional(),
      })
      .strict()
      .parse(body);
    const allowed = await transaction((db) => throttle(db, p.login_name));
    requireValue(allowed, 429, "Too many attempts. Try again in 15 minutes.");
    let token: string;
    if (route === "setup") {
      requireValue(
        config().SETUP_TOKEN &&
          equal(p.setup_token || "", config().SETUP_TOKEN!),
        403,
        "Invalid setup token",
      );
      const zone = p.timezone || "America/Edmonton";
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
      } catch {
        throw new HttpError(400, "Invalid timezone");
      }
      const verifier = await passwordHash(p.password);
      token = await transaction(async (db) => {
        await db.query(
          "SELECT * FROM installation WHERE singleton=1 FOR UPDATE",
        );
        requireValue(
          !(await db.query("SELECT id FROM owner")).rowCount,
          409,
          "Owner already exists. Sign in.",
        );
        const ownerId = randomUUID();
        await db.query(
          "INSERT INTO owner(id,login_name,password_hash) VALUES($1,$2,$3)",
          [ownerId, p.login_name, verifier],
        );
        await db.query(
          "INSERT INTO business_settings(owner_id,name,timezone,hourly_rate_minor) VALUES($1,$2,$3,$4)",
          [ownerId, p.name || p.login_name, zone, p.hourly_rate_minor || 0],
        );
        await db.query(
          "UPDATE installation SET completed_at=now() WHERE singleton=1",
        );
        await audit(db, "owner_created");
        return newSession(db, ownerId);
      });
    } else {
      const owner = (await pool().query("SELECT * FROM owner")).rows[0];
      requireValue(owner, 401, "Invalid login or password");
      const valid = await passwordValid(owner.password_hash, p.password);
      if (!valid || !equal(owner.login_name, p.login_name)) {
        await transaction((db) => audit(db, "login", "failure"));
        throw new HttpError(401, "Invalid login or password");
      }
      token = await transaction(async (db) => {
        await audit(db, "login");
        return newSession(db, owner.id);
      });
    }
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
  }
  requireValue(sess, 401, "Sign in to continue");
  if (method !== "GET") csrfCheck(req, sess.token);
  if (route === "request-key" && method === "GET")
    return json({ id: randomUUID() });
  if (route === "logout" && method === "POST") {
    await transaction(async (db) => {
      await db.query("UPDATE session SET revoked_at=now() WHERE id=$1", [
        sess.id,
      ]);
      await audit(db, "logout");
    });
    return json({ ok: true }, 200, {
      "Set-Cookie": sessionCookie("") + "; Max-Age=0",
    });
  }
  if (route === "settings" && method === "PUT") {
    const p = settingsInput.parse(await read(req));
    const r = await transaction((db) =>
      db.query(
        "UPDATE business_settings SET name=$1,timezone=$2,hourly_rate_minor=$3,rounding_minutes=$4,invoice_prefix=$5,tax_enabled=$6,vault_idle_minutes=$7,https_dismissed=$8,version=version+1,updated_at=now() WHERE version=$9 RETURNING *",
        [
          p.name,
          p.timezone,
          p.hourly_rate_minor,
          p.rounding_minutes,
          p.invoice_prefix,
          p.tax_enabled,
          p.vault_idle_minutes,
          p.https_dismissed,
          p.version,
        ],
      ),
    );
    requireValue(r.rowCount, 409, "Settings changed in another tab. Refresh.");
    return json(r.rows[0]);
  }
  if (route === "password" && method === "PUT") {
    const p = z
      .object({
        current: z.string().max(256),
        password: z.string().min(14).max(256),
      })
      .strict()
      .parse(await read(req));
    const allowed = await transaction((db) => throttle(db, "password_change"));
    requireValue(allowed, 429, "Too many attempts");
    const owner = (
      await pool().query("SELECT password_hash FROM owner WHERE id=$1", [
        sess.owner_id,
      ])
    ).rows[0];
    requireValue(
      await passwordValid(owner.password_hash, p.current),
      403,
      "Current password incorrect",
    );
    const hash = await passwordHash(p.password);
    await transaction(async (db) => {
      await db.query(
        "UPDATE owner SET password_hash=$1,updated_at=now() WHERE id=$2",
        [hash, sess.owner_id],
      );
      await db.query("UPDATE session SET revoked_at=now() WHERE owner_id=$1", [
        sess.owner_id,
      ]);
      await audit(db, "password_change");
    });
    return json({ ok: true });
  }
  if (route === "dashboard" && method === "GET") {
    const r = await pool().query(
      "SELECT (SELECT count(*) FROM client WHERE archived_at IS NULL)::int AS clients,(SELECT count(*) FROM activity WHERE status='open')::int AS open_activities,(SELECT COALESCE(sum(duration_seconds),0) FROM time_entry)::int AS tracked_seconds",
    );
    return json(r.rows[0]);
  }
  if (route === "clients" && method === "GET") {
    const r = await pool().query(
      "SELECT * FROM client WHERE archived_at IS NULL ORDER BY name",
    );
    return json(r.rows);
  }
  if (route === "clients" && method === "POST") {
    const p = clientInput.parse(await read(req));
    const r = await transaction((db) =>
      db.query(
        "INSERT INTO client(id,name,type,email,phone,billing_address,hourly_rate_minor) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          randomUUID(),
          p.name,
          p.type,
          p.email,
          p.phone,
          p.billing_address,
          p.hourly_rate_minor,
        ],
      ),
    );
    return json(r.rows[0], 201);
  }
  if (path[0] === "clients" && path.length === 2) {
    const clientId = id.parse(path[1]);
    if (method === "GET") {
      const r = await pool().query("SELECT * FROM client WHERE id=$1", [
        clientId,
      ]);
      requireValue(r.rowCount, 404, "Client not found");
      const [contacts, notes, activities, credentials] = await Promise.all([
        pool().query(
          "SELECT * FROM client_contact WHERE client_id=$1 ORDER BY created_at",
          [clientId],
        ),
        pool().query(
          "SELECT * FROM note WHERE client_id=$1 ORDER BY created_at DESC",
          [clientId],
        ),
        pool().query(
          "SELECT * FROM activity WHERE client_id=$1 ORDER BY created_at DESC",
          [clientId],
        ),
        pool().query(
          "SELECT id,title,client_id,version,created_at FROM credential WHERE client_id=$1 AND archived_at IS NULL ORDER BY title",
          [clientId],
        ),
      ]);
      return json({
        ...r.rows[0],
        contacts: contacts.rows,
        notes: notes.rows,
        activities: activities.rows,
        credentials: credentials.rows,
      });
    }
    if (method === "PUT") {
      const p = clientInput
        .extend({ version: z.number().int().min(1) })
        .parse(await read(req));
      const r = await transaction((db) =>
        db.query(
          "UPDATE client SET name=$1,type=$2,email=$3,phone=$4,billing_address=$5,hourly_rate_minor=$6,version=version+1,updated_at=now() WHERE id=$7 AND version=$8 RETURNING *",
          [
            p.name,
            p.type,
            p.email,
            p.phone,
            p.billing_address,
            p.hourly_rate_minor,
            clientId,
            p.version,
          ],
        ),
      );
      requireValue(r.rowCount, 409, "Client changed. Refresh.");
      return json(r.rows[0]);
    }
    if (method === "DELETE") {
      await transaction((db) =>
        db.query(
          "UPDATE client SET archived_at=now(),version=version+1 WHERE id=$1",
          [clientId],
        ),
      );
      return json({ ok: true });
    }
  }
  if (route === "contacts" && method === "POST") {
    const p = z
      .object({
        client_id: id,
        name: text(),
        email: z.union([z.literal(""), z.email()]),
        phone: z.string().max(80),
        role: z.string().max(80),
      })
      .strict()
      .parse(await read(req));
    return json(
      (
        await transaction((db) =>
          db.query(
            "INSERT INTO client_contact(id,client_id,name,email,phone,role) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [randomUUID(), p.client_id, p.name, p.email, p.phone, p.role],
          ),
        )
      ).rows[0],
      201,
    );
  }
  if (path[0] === "contacts" && path.length === 2 && method === "DELETE") {
    await transaction((db) =>
      db.query("DELETE FROM client_contact WHERE id=$1", [id.parse(path[1])]),
    );
    return json({ ok: true });
  }
  if (route === "notes" && method === "POST") {
    const p = z
      .object({
        client_id: id.nullable(),
        activity_id: id.nullable(),
        body: text(20000),
      })
      .strict()
      .refine((v) => Boolean(v.client_id) !== Boolean(v.activity_id))
      .parse(await read(req));
    return json(
      (
        await transaction((db) =>
          db.query(
            "INSERT INTO note(id,client_id,activity_id,body) VALUES($1,$2,$3,$4) RETURNING *",
            [randomUUID(), p.client_id, p.activity_id, p.body],
          ),
        )
      ).rows[0],
      201,
    );
  }
  if (path[0] === "notes" && path.length === 2 && method === "DELETE") {
    await transaction((db) =>
      db.query("DELETE FROM note WHERE id=$1", [id.parse(path[1])]),
    );
    return json({ ok: true });
  }
  if (route === "activities" && method === "GET") {
    return json(
      (
        await pool().query(
          "SELECT a.*,c.name AS client_name,COALESCE((SELECT sum(t.duration_seconds) FROM time_entry t WHERE t.activity_id=a.id),0)::int AS duration_seconds FROM activity a JOIN client c ON c.id=a.client_id ORDER BY a.created_at DESC",
        )
      ).rows,
    );
  }
  if (route === "activities" && method === "POST") {
    const p = activityInput.parse(await read(req)),
      key = id.parse(req.headers.get("idempotency-key"));
    const result = await transaction((db) =>
      once(db, key, "activity", p, async () => {
        const active = await db.query(
          "SELECT id FROM client WHERE id=$1 AND archived_at IS NULL",
          [p.client_id],
        );
        requireValue(active.rowCount, 400, "Choose an active client");
        const r = await db.query(
          "INSERT INTO activity(id,client_id,title,billable,notes) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [randomUUID(), p.client_id, p.title, p.billable, p.notes],
        );
        if (p.duration_seconds) {
          const e = await effective(db, r.rows[0].id);
          await db.query(
            "INSERT INTO time_entry(id,activity_id,duration_seconds,billable,source,rate_minor,rounding_minutes) VALUES($1,$2,$3,$4,'manual',$5,$6)",
            [
              randomUUID(),
              r.rows[0].id,
              p.duration_seconds,
              p.billable,
              e.rate_minor,
              e.rounding_minutes,
            ],
          );
        }
        return r.rows[0];
      }),
    );
    return json(result, 201);
  }
  if (path[0] === "activities" && path.length === 2) {
    const aid = id.parse(path[1]);
    if (method === "GET") {
      const r = await pool().query(
        "SELECT a.*,c.name AS client_name FROM activity a JOIN client c ON c.id=a.client_id WHERE a.id=$1",
        [aid],
      );
      requireValue(r.rowCount, 404, "Activity not found");
      return json({
        ...r.rows[0],
        entries: (
          await pool().query(
            "SELECT * FROM time_entry WHERE activity_id=$1 ORDER BY created_at DESC",
            [aid],
          )
        ).rows,
        notes: (
          await pool().query(
            "SELECT * FROM note WHERE activity_id=$1 ORDER BY created_at DESC",
            [aid],
          )
        ).rows,
      });
    }
    if (method === "PUT") {
      const p = z
        .object({
          title: text(500),
          billable: z.boolean(),
          status: z.enum(["open", "completed", "cancelled"]),
          notes: z.string().max(20000),
          version: z.number().int().positive(),
        })
        .strict()
        .parse(await read(req));
      const r = await transaction((db) =>
        db.query(
          "UPDATE activity SET title=$1,billable=$2,status=$3,notes=$4,version=version+1,updated_at=now() WHERE id=$5 AND version=$6 RETURNING *",
          [p.title, p.billable, p.status, p.notes, aid, p.version],
        ),
      );
      requireValue(r.rowCount, 409, "Activity changed. Refresh.");
      return json(r.rows[0]);
    }
  }
  if (route === "time-entries" && method === "POST") {
    const p = z
        .object({
          activity_id: id,
          duration_seconds: z.number().int().min(1).max(31536000),
        })
        .strict()
        .parse(await read(req)),
      key = id.parse(req.headers.get("idempotency-key"));
    return json(
      await transaction((db) =>
        once(db, key, "time-entry", p, async () => {
          const e = await effective(db, p.activity_id);
          return (
            await db.query(
              "INSERT INTO time_entry(id,activity_id,duration_seconds,billable,source,rate_minor,rounding_minutes) VALUES($1,$2,$3,$4,'manual',$5,$6) RETURNING *",
              [
                randomUUID(),
                p.activity_id,
                p.duration_seconds,
                e.billable,
                e.rate_minor,
                e.rounding_minutes,
              ],
            )
          ).rows[0];
        }),
      ),
      201,
    );
  }
  if (route === "timer" && method === "GET") {
    const r = await pool().query(
      "SELECT t.*,a.title,c.name AS client_name FROM timer t JOIN activity a ON a.id=t.activity_id JOIN client c ON c.id=a.client_id WHERE t.state IN ('running','paused')",
    );
    return json({
      timer: r.rows[0] || null,
      server_now: new Date().toISOString(),
    });
  }
  if (route === "timer" && method === "POST") {
    const p = z
        .object({
          action: z.enum(["start", "pause", "resume", "stop"]),
          activity_id: id.optional(),
          timer_id: id.optional(),
          version: z.number().int().positive().optional(),
        })
        .strict()
        .parse(await read(req)),
      key = id.parse(req.headers.get("idempotency-key"));
    return json(
      await transaction((db) =>
        once(db, key, "timer", p, async () => {
          await db.query("SELECT id FROM owner WHERE id=$1 FOR UPDATE", [
            sess.owner_id,
          ]);
          if (p.action === "start") {
            requireValue(p.activity_id, 400, "Choose an activity");
            requireValue(
              !(
                await db.query(
                  "SELECT id FROM timer WHERE owner_id=$1 AND state IN ('running','paused')",
                  [sess.owner_id],
                )
              ).rowCount,
              409,
              "Stop the active timer first",
            );
            const e = await effective(db, p.activity_id);
            return (
              await db.query(
                "INSERT INTO timer(id,owner_id,activity_id,state,segment_started_at,rate_minor,rounding_minutes,billable) VALUES($1,$2,$3,'running',clock_timestamp(),$4,$5,$6) RETURNING *",
                [
                  randomUUID(),
                  sess.owner_id,
                  p.activity_id,
                  e.rate_minor,
                  e.rounding_minutes,
                  e.billable,
                ],
              )
            ).rows[0];
          }
          requireValue(p.timer_id && p.version, 400, "Timer/version required");
          const t = (
            await db.query(
              "SELECT *,clock_timestamp() AS db_now FROM timer WHERE id=$1 FOR UPDATE",
              [p.timer_id],
            )
          ).rows[0];
          requireValue(
            t && t.state !== "stopped",
            409,
            "Timer already stopped",
          );
          requireValue(
            t.version === p.version,
            409,
            "Timer changed in another tab. Refresh.",
          );
          requireValue(
            p.action === "stop" ||
              (p.action === "pause" && t.state === "running") ||
              (p.action === "resume" && t.state === "paused"),
            409,
            "Invalid timer transition",
          );
          const elapsed =
              t.state === "running"
                ? Math.max(
                    0,
                    Math.floor(
                      (t.db_now.getTime() - t.segment_started_at.getTime()) /
                        1000,
                    ),
                  )
                : 0,
            total = t.accumulated_seconds + elapsed;
          if (t.state === "running")
            await db.query(
              "INSERT INTO timer_segment(id,timer_id,started_at,ended_at) VALUES($1,$2,$3,$4)",
              [randomUUID(), t.id, t.segment_started_at, t.db_now],
            );
          const state =
            p.action === "stop"
              ? "stopped"
              : p.action === "pause"
                ? "paused"
                : "running";
          const r = await db.query(
            "UPDATE timer SET state=$1,segment_started_at=$2,accumulated_seconds=$3,version=version+1 WHERE id=$4 RETURNING *",
            [state, state === "running" ? t.db_now : null, total, t.id],
          );
          if (state === "stopped" && total > 0)
            await db.query(
              "INSERT INTO time_entry(id,activity_id,timer_id,duration_seconds,billable,source,rate_minor,rounding_minutes) VALUES($1,$2,$3,$4,$5,'timer',$6,$7)",
              [
                randomUUID(),
                t.activity_id,
                t.id,
                total,
                t.billable,
                t.rate_minor,
                t.rounding_minutes,
              ],
            );
          return r.rows[0];
        }),
      ),
    );
  }
  if (route === "vault" && method === "GET") {
    const r = await pool().query(
      "SELECT id,format,hkdf_salt,password_envelope,recovery_envelope,version FROM vault",
    );
    return json(r.rows[0] || null);
  }
  if (route === "vault" && method === "POST") {
    const p = vaultCreate.parse(await read(req));
    return json(
      await transaction(async (db) => {
        requireValue(
          !(await db.query("SELECT id FROM vault")).rowCount,
          409,
          "Vault already exists",
        );
        await db.query(
          "INSERT INTO vault(id,owner_id,format,hkdf_salt,password_envelope,recovery_envelope) VALUES($1,$2,$3,$4,$5,$6)",
          [
            p.id,
            sess.owner_id,
            p.format,
            p.hkdf_salt,
            p.password_envelope,
            p.recovery_envelope,
          ],
        );
        await recordAudit(db, "create");
        return { ok: true };
      }),
      201,
    );
  }
  if (route === "vault" && method === "PUT") {
    const p = z
      .object({
        password_envelope: envelope,
        recovery_envelope: envelope.optional(),
        version: z.number().int().positive(),
      })
      .strict()
      .refine(
        (v) =>
          v.password_envelope.kind === "password" &&
          (!v.recovery_envelope || v.recovery_envelope.kind === "recovery"),
      )
      .parse(await read(req));
    await transaction(async (db) => {
      const r = await db.query(
        "UPDATE vault SET password_envelope=$1,recovery_envelope=COALESCE($2,recovery_envelope),version=version+1,updated_at=now() WHERE version=$3 RETURNING id",
        [p.password_envelope, p.recovery_envelope || null, p.version],
      );
      requireValue(r.rowCount, 409, "Vault changed. Lock and unlock again.");
      await recordAudit(
        db,
        p.recovery_envelope ? "recovery" : "password_change",
      );
    });
    return json({ ok: true });
  }
  if (route === "credentials" && method === "GET") {
    return json(
      (
        await pool().query(
          "SELECT id,client_id,title,version,created_at FROM credential WHERE archived_at IS NULL ORDER BY title",
        )
      ).rows,
    );
  }
  if (path[0] === "credentials" && path.length === 2 && method === "GET") {
    const r = await pool().query(
      "SELECT id,vault_id,client_id,title,payload,version FROM credential WHERE id=$1 AND archived_at IS NULL",
      [id.parse(path[1])],
    );
    requireValue(r.rowCount, 404, "Credential not found");
    return json(r.rows[0]);
  }
  if (route === "credentials" && (method === "POST" || method === "PUT")) {
    const p = credentialInput.parse(await read(req));
    const result = await transaction(async (db) => {
      const v = (await db.query("SELECT id FROM vault")).rows[0];
      requireValue(v, 409, "Create a vault first");
      requireValue(
        (
          await db.query(
            "SELECT id FROM client WHERE id=$1 AND archived_at IS NULL",
            [p.client_id],
          )
        ).rowCount,
        400,
        "Choose an active client",
      );
      await db.query(
        "INSERT INTO vault_nonce(vault_id,key_scope,nonce) VALUES($1,$2,$3)",
        [v.id, p.id, p.payload.nonce],
      );
      if (method === "POST") {
        requireValue(
          p.version === 0,
          400,
          "New credential version must be zero",
        );
        await db.query(
          "INSERT INTO credential(id,vault_id,client_id,title,payload) VALUES($1,$2,$3,$4,$5)",
          [p.id, v.id, p.client_id, p.title, p.payload],
        );
      } else {
        const r = await db.query(
          "UPDATE credential SET client_id=$1,title=$2,payload=$3,version=version+1,updated_at=now() WHERE id=$4 AND version=$5 AND archived_at IS NULL RETURNING id",
          [p.client_id, p.title, p.payload, p.id, p.version],
        );
        requireValue(
          r.rowCount,
          409,
          "Credential changed. Reopen it before saving.",
        );
      }
      await recordAudit(db, method === "POST" ? "create" : "edit", p.id);
      return { ok: true };
    });
    return json(result, method === "POST" ? 201 : 200);
  }
  if (path[0] === "credentials" && path.length === 2 && method === "DELETE") {
    const cid = id.parse(path[1]);
    await transaction(async (db) => {
      const r = await db.query(
        "UPDATE credential SET archived_at=now(),version=version+1 WHERE id=$1 AND archived_at IS NULL RETURNING id",
        [cid],
      );
      requireValue(r.rowCount, 404, "Credential not found");
      await recordAudit(db, "delete", cid);
    });
    return json({ ok: true });
  }
  if (route === "vault-audit" && method === "POST") {
    const p = z
      .object({ type: auditType, credential_id: id.nullable().default(null) })
      .strict()
      .parse(await read(req));
    await transaction((db) =>
      recordAudit(db, p.type, p.credential_id, "browser"),
    );
    return json({ ok: true });
  }
  if (route === "vault-audit" && method === "GET") {
    return json(
      (
        await pool().query(
          "SELECT id,credential_id,type,provenance,created_at FROM credential_audit_event ORDER BY created_at DESC LIMIT 100",
        )
      ).rows,
    );
  }
  if (route === "diagnostics" && method === "GET") {
    const { access, mkdir } = await import("node:fs/promises");
    const c = config();
    const result: Record<string, boolean> = {};
    for (const [k, p] of [
      ["uploads", c.FILE_STORAGE_PATH],
      ["backups", c.BACKUP_DIR],
    ]) {
      try {
        await mkdir(p, { recursive: true, mode: 0o700 });
        await access(p, 2);
        result[k] = true;
      } catch {
        result[k] = false;
      }
    }
    return json(result);
  }
  if (route === "backup" && method === "POST") {
    await read(req);
    const { backup } = await import("../scripts/backup");
    await backup();
    return json({ ok: true });
  }
  throw new HttpError(404, "Endpoint not found");
}
export async function api(req: Request, path: string[]) {
  try {
    return await handle(req, path);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof ZodError)
      return json(
        { error: "Invalid input. Check the required fields and formats." },
        400,
      );
    const code = (e as { code?: string })?.code;
    if (code === "23505")
      return json(
        {
          error:
            "This record or operation already exists. Refresh before retrying.",
        },
        409,
      );
    if (code === "23503")
      return json({ error: "Referenced record does not exist." }, 400);
    // No request bodies, transport errors, database parameters, or stack traces in logs.
    console.error("request_failed", {
      category: code && /^\d{5}$/.test(code) ? code : "internal",
    });
    return json(
      {
        error:
          "The operation could not be completed. Check service health and try again.",
      },
      500,
    );
  }
}
