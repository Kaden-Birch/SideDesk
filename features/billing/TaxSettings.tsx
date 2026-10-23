"use client";
import { useState, useEffect, type FormEvent } from "react";
import { request, requestKey } from "@/lib/client";
import { Field, Dialog } from "@/components/ui";
import { parseDecimal } from "./money";
import type { TaxProfile } from "./TaxControls";
export default function TaxSettings({
  notify,
}: {
  notify: (s: string) => void;
}) {
  const [rows, setRows] = useState<TaxProfile[]>([]),
    [editing, setEditing] = useState<TaxProfile | null | undefined>(),
    [name, setName] = useState(""),
    [parts, setParts] = useState([
      { label: "", percent: "0", compound: false },
    ]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setRows(await request<TaxProfile[]>("tax-profiles"));
  }
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, []);
  function open(p: TaxProfile | null) {
    setEditing(p);
    setName(p?.name || "");
    setParts(
      p
        ? p.components.map((c) => ({
            label: c.label,
            percent: String(c.rate_milli_percent / 1000),
            compound: c.compound,
          }))
        : [{ label: "", percent: "0", compound: false }],
    );
    setError("");
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        name,
        components: parts.map((p) => ({
          label: p.label,
          rate_milli_percent: parseDecimal(p.percent, 3),
          compound: p.compound,
        })),
      };
      await request(
        editing ? "tax-profiles/" + editing.id : "tax-profiles",
        editing ? "PUT" : "POST",
        { ...body, ...(editing ? { version: editing.version } : {}) },
        editing ? undefined : await requestKey(),
      );
      await load();
      setEditing(undefined);
      notify("Tax profile saved. Existing documents keep their snapshots.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="section-heading">
        <h2>Tax profiles</h2>
        <button onClick={() => open(null)}>New tax profile</button>
      </div>
      <p className="muted">
        Configure only taxes you apply. No registration, provincial rate or tax
        deduction is assumed. Enable taxes in Business defaults to apply these
        profiles.
      </p>
      {error && <p role="alert">{error}</p>}
      {rows.length ? (
        rows.map((p) => (
          <div className="history-event" key={p.id}>
            <strong>{p.name}</strong>
            <p>
              {p.components
                .map(
                  (c) =>
                    `${c.label} ${c.rate_milli_percent / 1000}%${c.compound ? " compounded" : ""}`,
                )
                .join(" + ")}
            </p>
            <div className="actions">
              <button onClick={() => open(p)}>Edit {p.name}</button>
              <button
                className="danger"
                onClick={async () => {
                  if (
                    !confirm(
                      "Archive this tax profile? Historical snapshots are preserved.",
                    )
                  )
                    return;
                  try {
                    await request("tax-profiles/" + p.id, "DELETE");
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Archive {p.name}
              </button>
            </div>
          </div>
        ))
      ) : (
        <p>
          No tax profiles. Zero-rated and exempt treatments remain available.
        </p>
      )}
      {editing !== undefined && (
        <Dialog
          title={editing ? "Edit tax profile" : "New tax profile"}
          onClose={() => setEditing(undefined)}
          drawer
        >
          <form onSubmit={save}>
            <Field label="Tax profile name">
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {parts.map((p, index) => (
              <fieldset key={index}>
                <legend>Component {index + 1}</legend>
                <Field label={`Tax component ${index + 1} label`}>
                  <input
                    required
                    maxLength={60}
                    value={p.label}
                    onChange={(e) =>
                      setParts((v) =>
                        v.map((x, i) =>
                          i === index ? { ...x, label: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label={`Tax component ${index + 1} rate (%)`}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.001"
                    required
                    value={p.percent}
                    onChange={(e) =>
                      setParts((v) =>
                        v.map((x, i) =>
                          i === index ? { ...x, percent: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={p.compound}
                    onChange={(e) =>
                      setParts((v) =>
                        v.map((x, i) =>
                          i === index
                            ? { ...x, compound: e.target.checked }
                            : x,
                        ),
                      )
                    }
                  />
                  Apply to net amount plus previous tax components
                </label>
                {parts.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setParts((v) => v.filter((_, i) => i !== index))
                    }
                  >
                    Remove component {index + 1}
                  </button>
                )}
              </fieldset>
            ))}
            {parts.length < 4 && (
              <button
                type="button"
                onClick={() =>
                  setParts((v) => [
                    ...v,
                    { label: "", percent: "0", compound: false },
                  ])
                }
              >
                Add tax component
              </button>
            )}
            {error && <p role="alert">{error}</p>}
            <div className="actions">
              <button className="primary" disabled={busy}>
                Save tax profile
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
