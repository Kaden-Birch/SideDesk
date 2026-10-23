import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import * as c from "../features/vault/crypto";
import { Secret as OTPSecret } from "otpauth";
import { vaultCreate, credentialInput } from "../lib/validation";
let v: c.Vault, key: Uint8Array<ArrayBuffer>, recovery: string;
const rid = "8b3d6c9f-c0f4-4567-9999-123456789012",
  cid = "8b3d6c9f-c0f4-4567-9999-123456789013";
beforeAll(async () => {
  vi.stubGlobal("isSecureContext", true);
  recovery = await c.recoveryKey();
  const result = await c.initialize("fictional-vault-password-123!", recovery);
  v = result.vault;
  key = result.vmk;
});
afterAll(() => {
  key.fill(0);
  vi.unstubAllGlobals();
});
describe("vault envelope and payload security", () => {
  it("unwraps with the separate password or recovery key", async () => {
    expect(await c.unwrap(v, "fictional-vault-password-123!")).toEqual(key);
    expect(await c.unwrap(v, recovery, true)).toEqual(key);
  });
  it("rejects wrong passwords and damaged recovery keys", async () => {
    await expect(c.unwrap(v, "wrong-password")).rejects.toThrow(
      "Unlock failed",
    );
    await expect(
      c.unwrap(
        v,
        recovery.slice(0, -1) + (recovery.endsWith("0") ? "1" : "0"),
        true,
      ),
    ).rejects.toThrow();
  });
  it("round-trips structured custom fields/TOTP and never sends known plaintext", async () => {
    const secret = {
      ...c.emptySecret,
      username: "SECRET_USERNAME_MARKER",
      password: "SECRET_PASSWORD_MARKER",
      fields: [
        { label: "label", value: "SECRET_CUSTOM_MARKER", secret: false },
      ],
      totp: [c.parseTotp("JBSWY3DPEHPK3PXP")],
    };
    const p = await c.encrypt(v, key, rid, cid, secret);
    expect(JSON.stringify(p)).not.toContain("SECRET_");
    expect(await c.decrypt(v, key, rid, cid, p)).toEqual(secret);
    const again = await c.encrypt(v, key, rid, cid, secret);
    expect(again.nonce).not.toEqual(p.nonce);
  });
  it("fails closed on ciphertext, nonce, revision, record and client substitution", async () => {
    const p = await c.encrypt(v, key, rid, cid, {
      ...c.emptySecret,
      password: "secret",
    });
    for (const changed of [
      {
        ...p,
        ciphertext:
          (p.ciphertext[0] === "A" ? "B" : "A") + p.ciphertext.slice(1),
      },
      { ...p, nonce: c.to64(new Uint8Array(12)) },
      { ...p, revision: crypto.randomUUID() },
    ])
      await expect(c.decrypt(v, key, rid, cid, changed)).rejects.toThrow(
        "integrity",
      );
    await expect(
      c.decrypt(v, key, crypto.randomUUID(), cid, p),
    ).rejects.toThrow("integrity");
    await expect(
      c.decrypt(v, key, rid, crypto.randomUUID(), p),
    ).rejects.toThrow("integrity");
  });
  it("authenticates envelope identity and KDF metadata", async () => {
    await expect(
      c.unwrap(
        {
          ...v,
          password_envelope: {
            ...v.password_envelope,
            id: crypto.randomUUID(),
          },
        },
        "fictional-vault-password-123!",
      ),
    ).rejects.toThrow();
  });
  it("rewraps without changing the VMK or credential ciphertext", async () => {
    const p = await c.encrypt(v, key, rid, cid, {
      ...c.emptySecret,
      password: "preserved",
    });
    const next = {
      ...v,
      password_envelope: await c.wrap(
        v.id,
        key,
        "new-vault-password-123!",
        "password",
      ),
    };
    const k = await c.unwrap(next, "new-vault-password-123!");
    expect(await c.decrypt(next, k, rid, cid, p)).toEqual({
      ...c.emptySecret,
      password: "preserved",
    });
    await expect(
      c.unwrap(next, "fictional-vault-password-123!"),
    ).rejects.toThrow();
  });
  it("disables cryptography in an insecure context without a fallback", async () => {
    vi.stubGlobal("isSecureContext", false);
    try {
      expect(c.supported()).toBe(false);
      await expect(
        c.initialize("long-enough-password", recovery),
      ).rejects.toThrow("secure browser");
      await expect(
        c.decrypt(v, key, rid, cid, {
          format: 1,
          revision: crypto.randomUUID(),
          nonce: "",
          ciphertext: "",
        }),
      ).rejects.toThrow("secure browser");
    } finally {
      vi.stubGlobal("isSecureContext", true);
    }
  });
  it("validates ciphertext-only wire formats and rejects extra plaintext keys", () => {
    const { version: _, ...wire } = v;
    void _;
    expect(vaultCreate.safeParse(wire).success).toBe(true);
    expect(vaultCreate.safeParse({ ...wire, password: "NO" }).success).toBe(
      false,
    );
    expect(
      credentialInput.safeParse({
        id: rid,
        client_id: cid,
        title: "Title",
        payload: { username: "NO" },
        version: 0,
      }).success,
    ).toBe(false);
  });
});
describe("TOTP supported RFC 6238 vectors", () => {
  const seed = c.parseTotp(
    "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA1&digits=8&period=30",
  );
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("generates at %s", async (time, code) => {
    expect(c.totpCode(seed, Number(time) * 1000)).toEqual(code);
  });
  it("verifies SHA256 and SHA512 RFC vectors", () => {
    for (const [algorithm, raw, expected] of [
      ["SHA256", "12345678901234567890123456789012", "46119246"],
      [
        "SHA512",
        "1234567890123456789012345678901234567890123456789012345678901234",
        "90693936",
      ],
    ]) {
      const secret = OTPSecret.fromUTF8(raw).base32;
      const t = c.parseTotp(
        `otpauth://totp/Test?secret=${secret}&algorithm=${algorithm}&digits=8&period=30`,
      );
      expect(c.totpCode(t, 59000)).toBe(expected);
    }
  });
  it("honors URI algorithm/period/digits and rejects HOTP/unsupported digits", () => {
    const t = c.parseTotp(
      "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=6&period=60",
    );
    expect(t).toMatchObject({ algorithm: "SHA256", digits: 6, period: 60 });
    expect(() =>
      c.parseTotp("otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP&counter=0"),
    ).toThrow();
    expect(() =>
      c.parseTotp("otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=7"),
    ).toThrow();
  });
});
