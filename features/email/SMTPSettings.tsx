"use client";
import { useState, useEffect, type FormEvent } from "react";
import { request } from "@/lib/client";
import { Field } from "@/components/ui";
type Settings = {
  configured: boolean;
  key_available: boolean;
  host: string;
  port: number;
  security: "tls" | "starttls" | "plain";
  username: string;
  from_address: string;
  from_name: string;
  version: number;
  has_password: boolean;
};
export default function SMTPSettings({
  notify,
}: {
  notify: (s: string) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [security, setSecurity] = useState("starttls");
  async function load() {
    const s = await request<Settings>("smtp");
    setSettings(s);
    setSecurity(s.security || "starttls");
  }
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, []);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      fd = new FormData(form),
      v = (key: string) => String(fd.get(key) || "");
    setBusy(true);
    setError("");
    try {
      await request("smtp", "PUT", {
        version: settings?.version || 0,
        host: v("host"),
        port: Number(v("port")),
        security,
        username: v("username"),
        ...(v("password") ? { password: v("password") } : {}),
        clear_password: fd.get("clear_password") === "on",
        from_address: v("from_address"),
        from_name: v("from_name"),
      });
      (form.elements.namedItem("password") as HTMLInputElement).value = "";
      await load();
      notify(
        "SMTP settings saved. Password is encrypted separately from the client vault.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>SMTP email</h2>
      <p className="muted">
        Optional. Messages attach the exact published PDF. Server acceptance is
        recorded; inbox delivery is not guaranteed.
      </p>
      {!settings?.key_available && (
        <p className="notice">
          Authenticated SMTP needs a dedicated SMTP_ENCRYPTION_KEY on the
          deployment. Plain relay mode cannot use a username or password.
        </p>
      )}
      {settings && (
        <form key={settings.version || 0} onSubmit={save}>
          <div className="form-grid">
            <Field label="SMTP host">
              <input
                name="host"
                required
                maxLength={253}
                defaultValue={settings.host || ""}
                placeholder="smtp.example.invalid"
              />
            </Field>
            <Field label="SMTP port">
              <input
                name="port"
                required
                type="number"
                min="1"
                max="65535"
                defaultValue={settings.port || 587}
              />
            </Field>
            <Field label="SMTP transport security">
              <select
                value={security}
                onChange={(e) => setSecurity(e.target.value)}
              >
                <option value="starttls">Required STARTTLS</option>
                <option value="tls">Implicit TLS</option>
                <option value="plain">
                  Plain local relay — no authentication
                </option>
              </select>
            </Field>
            <Field label="SMTP username">
              <input
                name="username"
                maxLength={256}
                defaultValue={settings.username || ""}
                disabled={security === "plain"}
                autoComplete="off"
              />
            </Field>
            <Field
              label="SMTP password"
              hint={
                settings.has_password
                  ? "Leave blank to retain the encrypted password."
                  : "Set a password for authenticated SMTP."
              }
            >
              <input
                name="password"
                type="password"
                maxLength={1024}
                disabled={security === "plain" || !settings.key_available}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Sender email">
              <input
                name="from_address"
                type="email"
                required
                maxLength={254}
                defaultValue={settings.from_address || ""}
              />
            </Field>
            <Field label="Sender name">
              <input
                name="from_name"
                maxLength={160}
                defaultValue={settings.from_name || ""}
              />
            </Field>
          </div>
          {security === "plain" && (
            <p className="notice">
              Plain SMTP provides no transport confidentiality. Use only an
              explicitly trusted local relay; credentials cannot be sent in this
              mode.
            </p>
          )}
          <label className="check">
            <input type="checkbox" name="clear_password" />
            Clear the saved SMTP password
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="actions">
            <button className="primary" disabled={busy}>
              Save SMTP settings
            </button>
            <button
              type="button"
              disabled={busy || !settings.configured}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const r = await request<{ message: string }>(
                    "smtp/test",
                    "POST",
                    {},
                  );
                  notify(r.message);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Test saved SMTP connection
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
