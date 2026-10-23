"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { request, type Client, type CredentialMeta } from "@/lib/client";
import { Dialog, Empty, Field, Tag } from "./ui";
import * as crypt from "@/features/vault/crypto";
import type { Secret, Vault, Ciphertext } from "@/features/vault/crypto";
import jsQR from "jsqr";
type Full = CredentialMeta & { vault_id: string; payload: Ciphertext };
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Operation failed";
export default function VaultPanel({
  clients,
  idleMinutes,
  lockSignal,
  notify,
  onLockState,
}: {
  clients: Client[];
  idleMinutes: number;
  lockSignal: number;
  notify: (s: string) => void;
  onLockState: (v: boolean) => void;
}) {
  const [vault, setVault] = useState<Vault | null>(null),
    [loaded, setLoaded] = useState(false),
    [items, setItems] = useState<CredentialMeta[]>([]),
    [unlocked, setUnlocked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [dialog, setDialog] = useState<
      "create" | "recover" | "password" | "rehearse" | null
    >(null),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [recovery, setRecovery] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [newKey, setNewKey] = useState("");
  const [selected, setSelected] = useState<Full | null>(null),
    [secret, setSecret] = useState<Secret | null>(null),
    [editing, setEditing] = useState(false),
    [newRecord, setNewRecord] = useState(false),
    [title, setTitle] = useState(""),
    [clientId, setClientId] = useState(""),
    [totpInput, setTotpInput] = useState(""),
    [now, setNow] = useState(() => Date.now());
  const draftId = useRef("");
  const vmk = useRef<Uint8Array<ArrayBuffer> | null>(null),
    epoch = useRef(0),
    mounted = useRef(true),
    lastActivity = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null),
    camera = useRef<MediaStream | null>(null),
    video = useRef<HTMLVideoElement>(null),
    [scanning, setScanning] = useState(false);
  const canUse = crypt.supported();
  const audit = useCallback(
    (type: string, credential_id: string | null = null) => {
      void request("vault-audit", "POST", { type, credential_id }).catch(
        () => {},
      );
    },
    [],
  );
  const stopCamera = useCallback(() => {
    camera.current?.getTracks().forEach((t) => t.stop());
    camera.current = null;
    setScanning(false);
  }, []);
  const clearSecrets = useCallback(() => {
    epoch.current++;
    vmk.current?.fill(0);
    vmk.current = null;
    setUnlocked(false);
    onLockState(false);
    setSecret(null);
    setSelected(null);
    setEditing(false);
    setPassword("");
    setConfirmPassword("");
    setRecovery("");
    setConfirmation("");
    setNewKey("");
    setTotpInput("");
    setDialog(null);
    stopCamera();
  }, [onLockState, stopCamera]);
  const lock = useCallback(
    (broadcast = true) => {
      clearSecrets();
      audit("lock");
      if (broadcast) channel.current?.postMessage("lock");
    },
    [clearSecrets, audit],
  );
  const load = useCallback(async () => {
    const [v, i] = await Promise.all([
      request<Vault | null>("vault"),
      request<CredentialMeta[]>("credentials"),
    ]);
    if (mounted.current) {
      setVault(v);
      setItems(i);
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load().catch((e) => setError(message(e)));
    channel.current = new BroadcastChannel("sidedesk-vault-lock");
    channel.current.onmessage = (e) => {
      if (e.data === "lock") lock(false);
    };
    return () => {
      mounted.current = false;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- This counter intentionally invalidates the current in-flight operation during cleanup.
      epoch.current++;
      vmk.current?.fill(0);
      vmk.current = null;
      camera.current?.getTracks().forEach((t) => t.stop());
      channel.current?.close();
      onLockState(false);
    };
  }, [load, lock, onLockState]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A lock signal must clear decrypted state immediately.
    if (lockSignal) lock();
  }, [lockSignal, lock]);
  useEffect(() => {
    const activity = () => {
      lastActivity.current = Date.now();
    };
    const hidden = () => {
      if (document.hidden) lock();
    };
    const tick = setInterval(() => {
      setNow(Date.now());
      if (
        vmk.current &&
        Date.now() - lastActivity.current > idleMinutes * 60000
      )
        lock();
    }, 1000);
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearInterval(tick);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [idleMinutes, lock]);
  const run = async (fn: (generation: number) => Promise<void>) => {
    setBusy(true);
    setError("");
    const generation = epoch.current;
    try {
      await fn(generation);
    } catch (e) {
      if (generation === epoch.current) setError(message(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const current = (generation: number) =>
    generation === epoch.current && mounted.current;
  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    await run(async (gen) => {
      if (!vault) return;
      let key: Uint8Array<ArrayBuffer>;
      try {
        key = await crypt.unwrap(vault, password);
      } catch (e) {
        audit("unlock_failed");
        throw e;
      }
      if (!current(gen)) {
        key.fill(0);
        return;
      }
      vmk.current = key;
      setPassword("");
      setUnlocked(true);
      onLockState(true);
      lastActivity.current = Date.now();
      audit("unlock");
    });
  };
  async function openDialog(kind: typeof dialog) {
    setError("");
    setPassword("");
    setConfirmPassword("");
    setRecovery("");
    setConfirmation("");
    setNewKey("");
    setDialog(kind);
    if (kind === "create" || kind === "recover") {
      const gen = epoch.current;
      const key = await crypt.recoveryKey();
      if (current(gen)) setNewKey(key);
    }
  }
  async function saveEnvelope(e: FormEvent) {
    e.preventDefault();
    await run(async (gen) => {
      if (dialog === "create" || dialog === "recover") {
        if (password !== confirmPassword)
          throw new Error("Vault passwords do not match");
        if (
          newKey.replaceAll("-", "") !==
          confirmation.replace(/[-\s]/g, "").toLowerCase()
        )
          throw new Error("Confirm the complete recovery key");
        if (dialog === "create") {
          const result = await crypt.initialize(password, newKey);
          if (!current(gen)) {
            result.vmk.fill(0);
            return;
          }
          try {
            const { version: _, ...body } = result.vault;
            void _;
            await request("vault", "POST", body);
            if (!current(gen)) {
              result.vmk.fill(0);
              return;
            }
            vmk.current = result.vmk;
            setVault(result.vault);
          } catch (e) {
            result.vmk.fill(0);
            throw e;
          }
        } else {
          if (!vault) return;
          if (password.length < 14)
            throw new Error("Use at least 14 characters");
          const key = await crypt.unwrap(vault, recovery, true);
          try {
            const p = await crypt.wrap(vault.id, key, password, "password"),
              r = await crypt.wrap(vault.id, key, newKey, "recovery");
            if (!current(gen)) return;
            await request("vault", "PUT", {
              password_envelope: p,
              recovery_envelope: r,
              version: vault.version,
            });
            if (!current(gen)) return;
            vmk.current?.fill(0);
            vmk.current = new Uint8Array(key);
            setVault({
              ...vault,
              password_envelope: p,
              recovery_envelope: r,
              version: vault.version + 1,
            });
          } finally {
            key.fill(0);
          }
        }
        if (current(gen)) {
          setUnlocked(true);
          onLockState(true);
          lastActivity.current = Date.now();
          setDialog(null);
          setPassword("");
          setConfirmPassword("");
          setNewKey("");
          setRecovery("");
          setConfirmation("");
          notify("Vault ready. Keep the recovery key offline.");
        }
      } else if (dialog === "password" && vault && vmk.current) {
        if (password !== confirmPassword || password.length < 14)
          throw new Error("Use matching passwords of at least 14 characters");
        const p = await crypt.wrap(vault.id, vmk.current, password, "password");
        if (!current(gen)) return;
        await request("vault", "PUT", {
          password_envelope: p,
          version: vault.version,
        });
        if (!current(gen)) return;
        setVault({
          ...vault,
          password_envelope: p,
          version: vault.version + 1,
        });
        setDialog(null);
        setPassword("");
        setConfirmPassword("");
        notify("Vault password changed; credential ciphertext is unchanged.");
      } else if (dialog === "rehearse" && vault && vmk.current) {
        const key = await crypt.unwrap(vault, recovery, true);
        try {
          if (!current(gen)) return;
          if (!key.every((b, i) => b === vmk.current?.[i]))
            throw new Error("Recovery key does not unlock this vault");
          if (items[0]) {
            const item = await request<Full>("credentials/" + items[0].id);
            await crypt.decrypt(
              vault,
              key,
              item.id,
              item.client_id,
              item.payload,
            );
          }
          if (!current(gen)) return;
          setDialog(null);
          setRecovery("");
          notify(
            "Recovery rehearsal passed. Vault key and sample credential verified.",
          );
        } finally {
          key.fill(0);
        }
      }
    });
  }
  async function openItem(item: CredentialMeta) {
    await run(async (gen) => {
      if (!vault || !vmk.current) return;
      const full = await request<Full>("credentials/" + item.id);
      const value = await crypt.decrypt(
        vault,
        vmk.current,
        full.id,
        full.client_id,
        full.payload,
      );
      if (!current(gen)) return;
      setSelected(full);
      setSecret(value);
      setTitle(full.title);
      setClientId(full.client_id);
      setNewRecord(false);
      setEditing(false);
    });
  }
  function newCredential() {
    setSelected(null);
    draftId.current = crypto.randomUUID();
    setSecret(structuredClone(crypt.emptySecret));
    setTitle("");
    setClientId(clients[0]?.id || "");
    setNewRecord(true);
    setEditing(true);
    setError("");
  }
  async function saveCredential(e: FormEvent) {
    e.preventDefault();
    await run(async (gen) => {
      if (!secret || !vmk.current || !vault) return;
      const recordId = selected?.id || draftId.current;
      const payload = await crypt.encrypt(
        vault,
        vmk.current,
        recordId,
        clientId,
        secret,
      );
      if (!current(gen)) return;
      await request("credentials", newRecord ? "POST" : "PUT", {
        id: recordId,
        client_id: clientId,
        title,
        payload,
        version: selected?.version || 0,
      });
      if (!current(gen)) return;
      setSecret(null);
      setSelected(null);
      setEditing(false);
      await load();
      notify("Encrypted credential saved.");
    });
  }
  async function copy(value: string, type = "copy") {
    if (!crypt.supported() || !navigator.clipboard?.writeText)
      throw new Error(
        "Clipboard unavailable. Use a supported secure browser context and check permissions.",
      );
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      throw new Error("Copy failed. Clipboard permission was denied.");
    }
    audit(type, selected?.id || null);
    notify("Copied to clipboard.");
  }
  async function readQr(file: File) {
    if (file.size > 10000000) throw new Error("QR image must be under 10 MB");
    const image = await createImageBitmap(file);
    try {
      if (image.width > 4096 || image.height > 4096)
        throw new Error("QR image dimensions exceed 4096 pixels");
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Image decoding unavailable");
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(pixels.data, pixels.width, pixels.height);
      if (!result) throw new Error("No QR code found");
      addTotp(result.data);
    } finally {
      image.close();
    }
  }
  function addTotp(input: string) {
    const t = crypt.parseTotp(input);
    setSecret((s) => (s ? { ...s, totp: [...s.totp, t] } : s));
    setTotpInput("");
    stopCamera();
  }
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Camera unavailable. Paste a secret/URI or upload a QR image.",
      );
    const gen = epoch.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    if (!current(gen)) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    camera.current = stream;
    setScanning(true);
  }
  useEffect(() => {
    if (!scanning || !video.current) return;
    video.current.srcObject = camera.current;
    void video.current.play().catch(() => {
      setError("Camera preview failed. Upload a QR image instead.");
      stopCamera();
    });
    const interval = setInterval(() => {
      const v = video.current;
      if (!v?.videoWidth) return;
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1024 / v.videoWidth);
      canvas.width = v.videoWidth * scale;
      canvas.height = v.videoHeight * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height),
        result = jsQR(pixels.data, pixels.width, pixels.height);
      if (result) {
        try {
          const t = crypt.parseTotp(result.data);
          setSecret((s) => (s ? { ...s, totp: [...s.totp, t] } : s));
          stopCamera();
        } catch {
          setError("QR code is not a supported TOTP authenticator.");
          stopCamera();
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [scanning, stopCamera]);
  if (!loaded) return <p role="status">Loading vault metadata… {error}</p>;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h1>Credentials</h1>
          <p>Client secrets, encrypted in your browser.</p>
        </div>
        <Tag>{unlocked ? "Unlocked" : "Locked"}</Tag>
      </div>
      {error && (
        <p role="alert" className="alert danger">
          {error}
        </p>
      )}
      <div className="notice">
        <strong>Before storing real credentials</strong>
        <p>
          This implementation requires an independent security review. Client
          associations and credential titles are visible while locked. All
          entered credential fields, including usernames, URLs and TOTP seeds,
          are encrypted. TOTP in the same vault reduces factor independence.
        </p>
      </div>
      {!canUse ? (
        <div className="alert">
          <h2>Vault unavailable in this browser context</h2>
          <p>
            Open SideDesk over HTTPS, or use a browser-supported localhost
            context. Encryption will never be disabled to compensate. Ordinary
            clients and work remain available.
          </p>
        </div>
      ) : !vault ? (
        <div className="card">
          <h2>Set up your separate vault</h2>
          <p>
            Your SideDesk login does not unlock credentials. Create a separate
            password and keep the recovery key offline.
          </p>
          <button className="primary" onClick={() => void openDialog("create")}>
            Create vault
          </button>
        </div>
      ) : !unlocked ? (
        <form className="card unlock" onSubmit={unlock}>
          <h2>Unlock your vault</h2>
          <Field label="Vault password">
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={256}
            />
          </Field>
          <div className="actions">
            <button className="primary" disabled={busy}>
              {busy ? "Unlocking…" : "Unlock vault"}
            </button>
            <button type="button" onClick={() => void openDialog("recover")}>
              Use recovery key
            </button>
          </div>
        </form>
      ) : (
        <div className="toolbar">
          <button
            className="primary"
            disabled={!clients.length || busy}
            onClick={newCredential}
          >
            New credential
          </button>
          <button onClick={() => lock()}>Lock vault</button>
          <button onClick={() => void openDialog("password")}>
            Change vault password
          </button>
          <button onClick={() => void openDialog("rehearse")}>
            Test recovery key
          </button>
          <small>
            Locks after {idleMinutes} minutes, when hidden, or when leaving this
            section.
          </small>
        </div>
      )}
      {!clients.length && (
        <p className="muted">Create a client before adding a credential.</p>
      )}
      {items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Credential</th>
                <th>Client</th>
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {unlocked ? (
                      <button className="link" onClick={() => void openItem(i)}>
                        {i.title}
                      </button>
                    ) : (
                      i.title
                    )}
                  </td>
                  <td>
                    {clients.find((c) => c.id === i.client_id)?.name ||
                      "Archived client"}
                  </td>
                  <td>{unlocked ? "Available" : "Locked"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No credentials yet">
          Create your vault and add a client credential when ready.
        </Empty>
      )}
      {dialog && (
        <Dialog
          title={
            {
              create: "Create encrypted vault",
              recover: "Recover vault",
              password: "Change vault password",
              rehearse: "Recovery rehearsal",
            }[dialog]
          }
          onClose={() => {
            epoch.current++;
            setBusy(false);
            setDialog(null);
            setPassword("");
            setConfirmPassword("");
            setRecovery("");
            setConfirmation("");
            setNewKey("");
          }}
        >
          <form onSubmit={saveEnvelope} className="stack">
            {error && (
              <p className="alert danger" role="alert">
                {error}
              </p>
            )}
            {(dialog === "recover" || dialog === "rehearse") && (
              <Field label="Existing recovery key">
                <textarea
                  autoComplete="off"
                  spellCheck={false}
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                  required
                />
              </Field>
            )}
            {dialog !== "rehearse" && (
              <>
                <Field
                  label="New vault password"
                  hint="14–256 characters. Use a different password from your login."
                >
                  <input
                    type="password"
                    minLength={14}
                    maxLength={256}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Confirm vault password">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </Field>
              </>
            )}
            {(dialog === "create" || dialog === "recover") && (
              <>
                <p className="alert">
                  Save this recovery key offline. Losing both this key and the
                  vault password makes secrets unrecoverable. Recovery replaces
                  the previous recovery key.
                </p>
                <code className="recovery-key">{newKey || "Generating…"}</code>
                <Field label="Confirm the complete new recovery key">
                  <textarea
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    required
                  />
                </Field>
              </>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "Working…"
                : dialog === "rehearse"
                  ? "Run rehearsal"
                  : "Save encrypted envelopes"}
            </button>
          </form>
        </Dialog>
      )}
      {secret && unlocked && (
        <Dialog
          title={
            editing ? (newRecord ? "New credential" : "Edit credential") : title
          }
          onClose={() => {
            epoch.current++;
            setBusy(false);
            setSecret(null);
            setSelected(null);
            setEditing(false);
            setTotpInput("");
            stopCamera();
          }}
        >
          {error && (
            <p role="alert" className="alert danger">
              {error}
            </p>
          )}
          {editing ? (
            <form className="stack" onSubmit={saveCredential}>
              <Field label="Credential title (visible while locked)">
                <input
                  value={title}
                  maxLength={160}
                  required
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field label="Client">
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  required
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              {(
                [
                  "username",
                  "password",
                  "url",
                  "notes",
                  "recovery_codes",
                ] as const
              ).map((k) => (
                <Field
                  key={k}
                  label={
                    {
                      username: "Username / email",
                      password: "Password",
                      url: "Service URL",
                      notes: "Sensitive notes",
                      recovery_codes: "Recovery codes",
                    }[k]
                  }
                >
                  {k === "notes" || k === "recovery_codes" ? (
                    <textarea
                      value={secret[k]}
                      autoComplete="off"
                      onChange={(e) =>
                        setSecret({ ...secret, [k]: e.target.value })
                      }
                    />
                  ) : (
                    <input
                      type={k === "password" ? "password" : "text"}
                      value={secret[k]}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) =>
                        setSecret({ ...secret, [k]: e.target.value })
                      }
                    />
                  )}
                </Field>
              ))}
              <h3>Custom fields</h3>
              {secret.fields.map((f, index) => (
                <div className="custom-field" key={index}>
                  <Field label="Field label">
                    <input
                      value={f.label}
                      onChange={(e) =>
                        setSecret({
                          ...secret,
                          fields: secret.fields.map((x, j) =>
                            j === index ? { ...x, label: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label="Field value">
                    <input
                      type={f.secret ? "password" : "text"}
                      autoComplete="off"
                      value={f.value}
                      onChange={(e) =>
                        setSecret({
                          ...secret,
                          fields: secret.fields.map((x, j) =>
                            j === index ? { ...x, value: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={f.secret}
                      onChange={(e) =>
                        setSecret({
                          ...secret,
                          fields: secret.fields.map((x, j) =>
                            j === index
                              ? { ...x, secret: e.target.checked }
                              : x,
                          ),
                        })
                      }
                    />
                    Mask by default
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setSecret({
                        ...secret,
                        fields: secret.fields.filter((_, j) => j !== index),
                      })
                    }
                  >
                    Remove field
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setSecret({
                    ...secret,
                    fields: [
                      ...secret.fields,
                      { label: "", value: "", secret: true },
                    ],
                  })
                }
              >
                Add custom field
              </button>
              <h3>Authenticators</h3>
              {secret.totp.map((t, i) => (
                <div className="row" key={i}>
                  <span>
                    {t.label} · {t.algorithm}, {t.digits} digits, {t.period}s
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSecret({
                        ...secret,
                        totp: secret.totp.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Remove authenticator
                  </button>
                </div>
              ))}
              <Field label="TOTP Base32 secret or otpauth URI">
                <input
                  value={totpInput}
                  type="password"
                  autoComplete="off"
                  onChange={(e) => setTotpInput(e.target.value)}
                />
              </Field>
              <div className="actions">
                <button
                  type="button"
                  disabled={!totpInput}
                  onClick={() => void run(async () => addTotp(totpInput))}
                >
                  Add authenticator
                </button>
                <button
                  type="button"
                  onClick={() => void run(async () => startCamera())}
                >
                  Scan QR with camera
                </button>
              </div>
              <Field label="Or upload QR image (processed locally)">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void run(async () => readQr(file));
                    e.target.value = "";
                  }}
                />
              </Field>
              {scanning && (
                <>
                  <video
                    ref={video}
                    muted
                    playsInline
                    aria-label="QR camera preview"
                  />
                  <button type="button" onClick={stopCamera}>
                    Stop camera
                  </button>
                </>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "Encrypting…" : "Encrypt and save"}
              </button>
            </form>
          ) : (
            <div className="stack">
              <p className="muted">
                Client: {clients.find((c) => c.id === clientId)?.name}
              </p>
              {(
                [
                  "username",
                  "password",
                  "url",
                  "notes",
                  "recovery_codes",
                ] as const
              )
                .filter((k) => secret[k])
                .map((k) => (
                  <SecretField
                    key={k}
                    label={
                      {
                        username: "Username / email",
                        password: "Password",
                        url: "Service URL",
                        notes: "Sensitive notes",
                        recovery_codes: "Recovery codes",
                      }[k]
                    }
                    value={secret[k]}
                    mask={k !== "username" && k !== "url"}
                    onReveal={() => audit("reveal", selected?.id)}
                    onCopy={() => run(async () => copy(secret[k]))}
                  />
                ))}
              {secret.fields.map((f, i) => (
                <SecretField
                  key={i}
                  label={f.label}
                  value={f.value}
                  mask={f.secret}
                  onReveal={() => audit("reveal", selected?.id)}
                  onCopy={() => run(async () => copy(f.value))}
                />
              ))}
              {secret.totp.map((t, i) => (
                <div className="totp" key={i}>
                  <span>{t.label}</span>
                  <strong>{crypt.totpCode(t, now)}</strong>
                  <span>{t.period - (Math.floor(now / 1000) % t.period)}s</span>
                  <button
                    onClick={() =>
                      void run(async () => copy(crypt.totpCode(t), "totp_copy"))
                    }
                  >
                    Copy TOTP
                  </button>
                </div>
              ))}
              <small>
                TOTP uses this device’s clock. Keep it synchronized.
              </small>
              <div className="actions">
                <button onClick={() => setEditing(true)}>
                  Edit credential
                </button>
                <button
                  className="danger-text"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Archive this credential? Its encrypted history remains in backups.",
                      )
                    )
                      void run(async (gen) => {
                        await request("credentials/" + selected!.id, "DELETE");
                        if (!current(gen)) return;
                        setSecret(null);
                        setSelected(null);
                        await load();
                        notify("Credential archived.");
                      });
                  }}
                >
                  Archive credential
                </button>
              </div>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
function SecretField({
  label,
  value,
  mask,
  onReveal,
  onCopy,
}: {
  label: string;
  value: string;
  mask: boolean;
  onReveal: () => void;
  onCopy: () => void;
}) {
  const [shown, setShown] = useState(!mask);
  return (
    <div className="secret-field">
      <span className="muted">{label}</span>
      <div className="row">
        <pre>{shown ? value : "••••••••••••"}</pre>
        {mask && (
          <button
            onClick={() => {
              if (!shown) onReveal();
              setShown(!shown);
            }}
          >
            {shown ? "Hide" : "Reveal"}
          </button>
        )}
        <button onClick={onCopy}>Copy</button>
      </div>
    </div>
  );
}
