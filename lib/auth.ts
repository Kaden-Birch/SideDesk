import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { PoolClient } from "pg";
import { config } from "./config";
import { pool } from "./db";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireValue(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function cookie(req: Request, name: string) {
  return (
    req.headers
      .get("cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
export const csrf = (binding: string) =>
  createHmac("sha256", config().SESSION_SECRET)
    .update("csrf:" + binding)
    .digest("hex");
export function originCheck(req: Request) {
  const expected = new URL(config().APP_URL);
  requireValue(
    req.headers.get("host") === expected.host,
    403,
    "Host not allowed",
  );
  if (!["GET", "HEAD"].includes(req.method))
    requireValue(
      req.headers.get("origin") === expected.origin,
      403,
      "Origin not allowed",
    );
}
export function csrfCheck(req: Request, binding: string) {
  requireValue(
    binding && equal(req.headers.get("x-csrf-token") || "", csrf(binding)),
    403,
    "Refresh the page and try again.",
  );
}
export function sessionCookie(token: string) {
  return `sidedesk_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${new URL(config().APP_URL).protocol === "https:" ? "; Secure" : ""}`;
}
export function preauthCookie(token: string) {
  return `sidedesk_preauth=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${new URL(config().APP_URL).protocol === "https:" ? "; Secure" : ""}`;
}
export async function getSession(req: Request) {
  const token = cookie(req, "sidedesk_session");
  if (!token) return null;
  const { rows } = await pool().query(
    "UPDATE session SET last_seen_at=now() WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() AND last_seen_at>now()-interval '30 minutes' RETURNING id,owner_id",
    [digest(token)],
  );
  return rows[0] ? { ...rows[0], token } : null;
}
export async function newSession(db: PoolClient, ownerId: string) {
  await db.query("DELETE FROM session WHERE expires_at<now()-interval '1 day'");
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO session(id,owner_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
    [randomUUID(), ownerId, digest(token)],
  );
  return token;
}
let activeKdfs = 0;
async function boundedKdf<T>(fn: () => Promise<T>): Promise<T> {
  requireValue(activeKdfs < 2, 429, "Authentication busy. Try again shortly.");
  activeKdfs++;
  try {
    return await fn();
  } finally {
    activeKdfs--;
  }
}
export async function passwordHash(password: string) {
  return boundedKdf(() =>
    hash(password, {
      algorithm: 2,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    }),
  );
}
export async function passwordValid(encoded: string, password: string) {
  try {
    return await boundedKdf(() => verify(encoded, password));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return false;
  }
}
export async function throttle(db: PoolClient, login: string) {
  await db.query(
    "DELETE FROM auth_rate_limit WHERE window_start<now()-interval '1 day'",
  );
  // Aggregate gate bounds hash work even when attackers vary login names; deployment is single-owner.
  for (const bucket of ["all", digest(login.toLowerCase())]) {
    const { rows } = await db.query(
      "INSERT INTO auth_rate_limit(bucket,attempts,window_start) VALUES($1,1,now()) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN auth_rate_limit.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_rate_limit.attempts+1 END,window_start=CASE WHEN auth_rate_limit.window_start<now()-interval '15 minutes' THEN now() ELSE auth_rate_limit.window_start END RETURNING attempts",
      [bucket],
    );
    // Commit the attempt before rejecting; caller returns a flag instead of throwing inside transaction.
    if (rows[0].attempts > 20) return false;
  }
  return true;
}
