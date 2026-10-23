// Browser-only implementation. No server component or route may import this module.
import { argon2id } from "hash-wasm";
import { z } from "zod";
import * as OTPAuth from "otpauth";
import { envelope, encryptedPayload } from "@/lib/validation";
export type Envelope = z.infer<typeof envelope>;
export type Ciphertext = z.infer<typeof encryptedPayload>;
export type Vault = {
  id: string;
  format: 1;
  hkdf_salt: string;
  password_envelope: Envelope;
  recovery_envelope: Envelope;
  version: number;
};
export const secretSchema = z
  .object({
    username: z.string().max(2000),
    password: z.string().max(10000),
    url: z.string().max(2000),
    notes: z.string().max(20000),
    recovery_codes: z.string().max(20000),
    fields: z
      .array(
        z
          .object({
            label: z.string().max(120),
            value: z.string().max(10000),
            secret: z.boolean(),
          })
          .strict(),
      )
      .max(40),
    totp: z
      .array(
        z
          .object({
            label: z.string().max(160),
            secret: z.string().regex(/^[A-Z2-7]+=*$/),
            algorithm: z.enum(["SHA1", "SHA256", "SHA512"]),
            digits: z.union([z.literal(6), z.literal(8)]),
            period: z.number().int().min(15).max(120),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export type Secret = z.infer<typeof secretSchema>;
export const emptySecret: Secret = {
  username: "",
  password: "",
  url: "",
  notes: "",
  recovery_codes: "",
  fields: [],
  totp: [],
};
const encoder = new TextEncoder();
const encoded = (v: unknown) => encoder.encode(JSON.stringify(v));
const encodeText = (v: string) => encoder.encode(v);
export function supported() {
  return (
    globalThis.isSecureContext === true &&
    Boolean(globalThis.crypto?.subtle) &&
    typeof globalThis.crypto?.getRandomValues === "function"
  );
}
function guard() {
  if (!supported())
    throw new Error("Vault requires a supported secure browser context.");
}
export function to64(v: Uint8Array<ArrayBuffer>) {
  let s = "";
  for (const b of v) s += String.fromCharCode(b);
  return btoa(s);
}
export function from64(v: string): Uint8Array<ArrayBuffer> {
  const s = atob(v);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function random(n: number) {
  guard();
  return crypto.getRandomValues(new Uint8Array(n));
}
async function hkdf(
  raw: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: unknown,
) {
  const k = await crypto.subtle.importKey("raw", raw, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoded(info) },
    k,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
function envelopeAAD(vaultId: string, e: Omit<Envelope, "ciphertext">) {
  return encoded([
    "SideDesk",
    1,
    "envelope",
    vaultId,
    e.id,
    e.kind,
    e.kdf,
    e.salt,
    e.memory,
    e.iterations,
    e.parallelism,
  ]);
}
async function wrappingKey(
  vaultId: string,
  password: string,
  e: Omit<Envelope, "ciphertext">,
) {
  let raw: Uint8Array<ArrayBuffer>;
  if (e.kind === "password") {
    if (password.length < 1 || password.length > 256)
      throw new Error("Invalid vault password length");
    raw = new Uint8Array(
      await argon2id({
        password: encodeText(password),
        salt: from64(e.salt),
        parallelism: e.parallelism,
        iterations: e.iterations,
        memorySize: e.memory,
        hashLength: 32,
        outputType: "binary",
      }),
    );
  } else raw = await decodeRecovery(password);
  try {
    return await hkdf(raw, from64(e.salt), [
      "SideDesk",
      1,
      "wrap",
      e.kind,
      vaultId,
      e.id,
    ]);
  } finally {
    raw.fill(0);
  }
}
export async function recoveryKey() {
  const raw = random(32),
    checksum = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  const hex = Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
  raw.fill(0);
  return (
    hex.match(/.{8}/g)!.join("-") +
    "-" +
    Array.from(checksum.slice(0, 4), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("")
  );
}
async function decodeRecovery(key: string) {
  const hex = key.replace(/[-\s]/g, "").toLowerCase();
  if (!/^[a-f0-9]{72}$/.test(hex)) throw new Error("Invalid recovery key");
  const raw = Uint8Array.from(hex.slice(0, 64).match(/../g)!, (v) =>
    parseInt(v, 16),
  );
  const sum = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  if (
    Array.from(sum.slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    ) !== hex.slice(64)
  )
    throw new Error("Invalid recovery checksum");
  return raw;
}
export async function wrap(
  vaultId: string,
  vmk: Uint8Array<ArrayBuffer>,
  password: string,
  kind: "password" | "recovery",
): Promise<Envelope> {
  guard();
  const e = {
    format: 1 as const,
    kind,
    id: crypto.randomUUID(),
    salt: to64(random(16)),
    nonce: to64(random(12)),
    kdf:
      kind === "password"
        ? ("argon2id-hkdf-sha256" as const)
        : ("hkdf-sha256" as const),
    memory: 65536 as const,
    iterations: 3 as const,
    parallelism: 4 as const,
  };
  const key = await wrappingKey(vaultId, password, e);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: from64(e.nonce),
      additionalData: envelopeAAD(vaultId, e),
      tagLength: 128,
    },
    key,
    vmk,
  );
  return { ...e, ciphertext: to64(new Uint8Array(ciphertext)) };
}
export async function unwrap(v: Vault, password: string, recovery = false) {
  guard();
  const e = envelope.parse(
    recovery ? v.recovery_envelope : v.password_envelope,
  );
  const key = await wrappingKey(v.id, password, e);
  try {
    const raw = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: from64(e.nonce),
          additionalData: envelopeAAD(v.id, e),
          tagLength: 128,
        },
        key,
        from64(e.ciphertext),
      ),
    );
    if (raw.length !== 32) throw new Error();
    return raw;
  } catch {
    throw new Error(
      "Unlock failed. Check the password/key or restore an intact vault backup.",
    );
  }
}
export async function initialize(password: string, recovery: string) {
  guard();
  if (password.length < 14 || password.length > 256)
    throw new Error("Use a vault password of 14–256 characters");
  const vmk = random(32),
    id = crypto.randomUUID();
  try {
    const v: Vault = {
      id,
      format: 1,
      hkdf_salt: to64(random(16)),
      password_envelope: await wrap(id, vmk, password, "password"),
      recovery_envelope: await wrap(id, vmk, recovery, "recovery"),
      version: 1,
    };
    return { vault: v, vmk };
  } catch (e) {
    vmk.fill(0);
    throw e;
  }
}
async function recordKey(
  v: Vault,
  vmk: Uint8Array<ArrayBuffer>,
  recordId: string,
) {
  return hkdf(vmk, from64(v.hkdf_salt), [
    "SideDesk",
    1,
    "credential",
    v.id,
    recordId,
    1,
  ]);
}
const payloadAAD = (
  v: Vault,
  recordId: string,
  clientId: string,
  revision: string,
) => encoded(["SideDesk", 1, "payload", v.id, recordId, clientId, 1, revision]);
export async function encrypt(
  v: Vault,
  vmk: Uint8Array<ArrayBuffer>,
  recordId: string,
  clientId: string,
  value: Secret,
): Promise<Ciphertext> {
  guard();
  const clean = secretSchema.parse(value),
    revision = crypto.randomUUID(),
    nonce = to64(random(12));
  const raw = encoded(clean);
  try {
    const key = await recordKey(v, vmk, recordId);
    return {
      format: 1,
      revision,
      nonce,
      ciphertext: to64(
        new Uint8Array(
          await crypto.subtle.encrypt(
            {
              name: "AES-GCM",
              iv: from64(nonce),
              additionalData: payloadAAD(v, recordId, clientId, revision),
              tagLength: 128,
            },
            key,
            raw,
          ),
        ),
      ),
    };
  } finally {
    raw.fill(0);
  }
}
export async function decrypt(
  v: Vault,
  vmk: Uint8Array<ArrayBuffer>,
  recordId: string,
  clientId: string,
  payload: Ciphertext,
): Promise<Secret> {
  guard();
  const p = encryptedPayload.parse(payload);
  try {
    const key = await recordKey(v, vmk, recordId);
    const raw = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: from64(p.nonce),
          additionalData: payloadAAD(v, recordId, clientId, p.revision),
          tagLength: 128,
        },
        key,
        from64(p.ciphertext),
      ),
    );
    try {
      return secretSchema.parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
      );
    } finally {
      raw.fill(0);
    }
  } catch {
    throw new Error(
      "Credential failed integrity verification. No secrets were displayed.",
    );
  }
}
export function parseTotp(input: string) {
  let t: OTPAuth.TOTP;
  if (input.trim().startsWith("otpauth://")) {
    const parsed = OTPAuth.URI.parse(input.trim());
    if (!(parsed instanceof OTPAuth.TOTP))
      throw new Error("Only time-based TOTP is supported");
    t = parsed;
  } else
    t = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(input.toUpperCase().replace(/\s/g, "")),
    });
  return secretSchema.shape.totp.element.parse({
    label: t.label || t.issuer || "Authenticator",
    secret: t.secret.base32,
    algorithm: t.algorithm,
    digits: t.digits,
    period: t.period,
  });
}
export function totpCode(t: Secret["totp"][number], timestamp = Date.now()) {
  guard();
  return new OTPAuth.TOTP({
    ...t,
    secret: OTPAuth.Secret.fromBase32(t.secret),
  }).generate({ timestamp });
}
