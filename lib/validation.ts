import { z } from "zod";
export const id = z.uuid();
export const text = (max = 160) => z.string().trim().min(1).max(max);
export const rate = z.number().int().min(0).max(100000000);
const b64 = (bytes: number) =>
  z.string().refine((v) => {
    try {
      const raw = atob(v);
      return raw.length === bytes && btoa(raw) === v;
    } catch {
      return false;
    }
  }, "Invalid canonical base64");
export const envelope = z
  .object({
    format: z.literal(1),
    kind: z.enum(["password", "recovery"]),
    id,
    nonce: b64(12),
    ciphertext: b64(48),
    salt: b64(16),
    kdf: z.enum(["argon2id-hkdf-sha256", "hkdf-sha256"]),
    memory: z.literal(65536),
    iterations: z.literal(3),
    parallelism: z.literal(4),
  })
  .strict()
  .refine((e) =>
    e.kind === "password"
      ? e.kdf === "argon2id-hkdf-sha256"
      : e.kdf === "hkdf-sha256",
  );
export const encryptedPayload = z
  .object({
    format: z.literal(1),
    revision: id,
    nonce: b64(12),
    ciphertext: z
      .string()
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .min(24)
      .max(200000),
  })
  .strict();
export const vaultCreate = z
  .object({
    id,
    format: z.literal(1),
    hkdf_salt: b64(16),
    password_envelope: envelope,
    recovery_envelope: envelope,
  })
  .strict()
  .refine(
    (v) =>
      v.password_envelope.kind === "password" &&
      v.recovery_envelope.kind === "recovery",
  );
export const credentialInput = z
  .object({
    id,
    client_id: id,
    title: text(),
    payload: encryptedPayload,
    version: z.number().int().min(0),
  })
  .strict();
export const settingsInput = z
  .object({
    name: text(),
    timezone: text(80).refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
    hourly_rate_minor: rate,
    rounding_minutes: z.union([
      z.literal(1),
      z.literal(5),
      z.literal(6),
      z.literal(10),
      z.literal(15),
      z.literal(30),
      z.literal(60),
    ]),
    invoice_prefix: text(20),
    tax_enabled: z.boolean(),
    vault_idle_minutes: z.number().int().min(1).max(60),
    https_dismissed: z.boolean(),
    version: z.number().int().min(1),
  })
  .strict();
export const clientInput = z
  .object({
    name: text(),
    type: z.enum(["person", "business"]),
    email: z.union([z.literal(""), z.email()]).default(""),
    phone: z.string().max(80).default(""),
    billing_address: z.string().max(1000).default(""),
    hourly_rate_minor: rate.nullable().default(null),
  })
  .strict();
export const activityInput = z
  .object({
    client_id: id,
    title: text(500),
    billable: z.boolean(),
    notes: z.string().max(20000).default(""),
    duration_seconds: z.number().int().min(0).max(31536000).default(0),
    job_id: id.nullable().default(null),
    rate_minor: rate.nullable().default(null),
  })
  .strict();
export const auditType = z.enum([
  "unlock",
  "unlock_failed",
  "lock",
  "reveal",
  "copy",
  "totp_copy",
  "recovery",
  "password_change",
]);
