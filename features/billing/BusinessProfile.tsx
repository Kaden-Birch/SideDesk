"use client";
import { useState, type FormEvent } from "react";
import { request, type Settings } from "@/lib/client";
import { Field } from "@/components/ui";
export default function BusinessProfile({
  settings,
  onSaved,
  notify,
}: {
  settings: Settings;
  onSaved: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget),
      get = (k: string) => String(fd.get(k) || "");
    setBusy(true);
    setError("");
    try {
      await request("billing-profile", "PUT", {
        version: settings.version,
        legal_name: get("legal_name"),
        address: get("address"),
        email: get("email"),
        phone: get("phone"),
        registration_number: get("registration_number"),
        payment_instructions: get("payment_instructions"),
        invoice_terms: get("invoice_terms"),
        rounding_scope: get("rounding_scope"),
        accent_color: get("accent_color"),
      });
      await onSaved();
      notify(
        "Invoice identity and billing policy saved. Issued documents remain unchanged.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Invoice identity & rounding</h2>
      <p className="muted">
        These values are copied into drafts when saved. Issued invoices retain
        their original identity and instructions.
      </p>
      {error && (
        <p role="alert" className="alert danger">
          {error}
        </p>
      )}
      <form className="stack" onSubmit={save} key={settings.version}>
        <Field
          label="Legal / issuer name"
          hint="Leave blank to use your business or personal name."
        >
          <input
            name="legal_name"
            defaultValue={settings.legal_name}
            maxLength={160}
          />
        </Field>
        <Field label="Issuer address">
          <textarea
            name="address"
            defaultValue={settings.address}
            maxLength={1000}
          />
        </Field>
        <Field label="Issuer email">
          <input type="email" name="email" defaultValue={settings.email} />
        </Field>
        <Field label="Issuer phone">
          <input name="phone" defaultValue={settings.phone} maxLength={80} />
        </Field>
        <Field label="Tax registration number (optional)">
          <input
            name="registration_number"
            defaultValue={settings.registration_number}
            maxLength={100}
          />
        </Field>
        <Field label="Payment instructions">
          <textarea
            name="payment_instructions"
            defaultValue={settings.payment_instructions}
            maxLength={2000}
          />
        </Field>
        <Field label="Default invoice terms">
          <textarea
            name="invoice_terms"
            defaultValue={settings.invoice_terms}
            maxLength={4000}
          />
        </Field>
        <Field
          label="Rounding scope"
          hint="Policy is snapshotted on new time entries. Existing time retains its recorded policy."
        >
          <select name="rounding_scope" defaultValue={settings.rounding_scope}>
            <option value="entry">Round each time entry up</option>
            <option value="group">
              Round invoice group up (same job, rate and increment)
            </option>
          </select>
        </Field>
        <Field label="Printed invoice accent">
          <input
            type="color"
            name="accent_color"
            defaultValue={settings.accent_color}
          />
        </Field>
        <button disabled={busy} className="primary">
          {busy ? "Saving…" : "Save invoice identity"}
        </button>
      </form>
    </section>
  );
}
