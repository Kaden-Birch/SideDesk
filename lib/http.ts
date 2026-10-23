import { z } from "zod";
import type { PoolClient } from "pg";
import { HttpError, requireValue, digest } from "./auth";
export const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
export async function read(req: Request) {
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
export async function once(
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

export function requestId(req: Request) {
  return z.uuid().parse(req.headers.get("idempotency-key"));
}
