"use client";
import { useState, useEffect, useCallback } from "react";
import { request, requestKey, type Client } from "@/lib/client";
import { Dialog, Field } from "@/components/ui";
import { money } from "@/features/billing/money";
import type { Charge } from "./service";
export function AddChargesButton({
  clientId,
  exclude,
  onAdd,
}: {
  clientId: string;
  exclude: string[];
  onAdd: (charges: Charge[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<Charge[]>([]),
    [picked, setPicked] = useState<string[]>([]),
    [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        disabled={!clientId}
        onClick={async () => {
          try {
            setRows(
              (await request<Charge[]>("unbilled-charges")).filter(
                (c) => c.client_id === clientId && !exclude.includes(c.id),
              ),
            );
            setPicked([]);
            setOpen(true);
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Add expense / travel charge
      </button>
      {error && !open && <p role="alert">{error}</p>}
      {open && (
        <Dialog
          title="Add unbilled charges"
          onClose={() => setOpen(false)}
          drawer
        >
          <p>
            Each entire expense or travel charge can be reserved once. Cost and
            customer recovery are separate.
          </p>
          {rows.map((c) => (
            <label className="check" key={c.id}>
              <input
                type="checkbox"
                checked={picked.includes(c.id)}
                onChange={(e) =>
                  setPicked((v) =>
                    e.target.checked
                      ? [...v, c.id]
                      : v.filter((id) => id !== c.id),
                  )
                }
              />
              {c.description} · {money(c.amount_minor)}
            </label>
          ))}
          {!rows.length && (
            <p>No unbilled expense or travel charges for this client.</p>
          )}
          <button
            className="primary"
            disabled={!picked.length}
            onClick={() => {
              onAdd(rows.filter((c) => picked.includes(c.id)));
              setOpen(false);
            }}
          >
            Add selected full charges
          </button>
        </Dialog>
      )}
    </>
  );
}
export default function ChargesQueue({
  clients,
  onNavigate,
  notify,
}: {
  clients: Client[];
  onNavigate: (view: string, id?: string) => void;
  notify: (s: string) => void;
}) {
  const [rows, setRows] = useState<Charge[]>([]),
    [picked, setPicked] = useState<string[]>([]),
    [filter, setFilter] = useState("all"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async () => setRows(await request<Charge[]>("unbilled-charges")),
    [],
  );
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, [load]);
  const visible = rows.filter(
      (c) => filter === "all" || c.client_id === filter,
    ),
    selected = rows.filter((c) => picked.includes(c.id)),
    clientId = selected[0]?.client_id;
  return (
    <section className="card">
      <h2>Unbilled expense & travel charges</h2>
      <p className="muted">
        Select full charges for one client. Drafts reserve them; issued invoices
        keep allocations until voided. Costs are never automatically treated as
        revenue.
      </p>
      {error && <p role="alert">{error}</p>}
      <Field label="Charge client filter">
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPicked([]);
          }}
        >
          <option value="all">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Charge</th>
              <th>Client</th>
              <th>Kind</th>
              <th>Customer charge CAD</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id}>
                <td>
                  <label className="check">
                    <input
                      type="checkbox"
                      aria-label={`Select charge ${c.description}`}
                      checked={picked.includes(c.id)}
                      disabled={Boolean(clientId && clientId !== c.client_id)}
                      onChange={(e) =>
                        setPicked((v) =>
                          e.target.checked
                            ? [...v, c.id]
                            : v.filter((id) => id !== c.id),
                        )
                      }
                    />
                    {c.description}
                  </label>
                </td>
                <td>{c.client_name}</td>
                <td>{c.kind.replaceAll("_", " ")}</td>
                <td>{money(c.amount_minor)}</td>
                <td>
                  <button
                    className="link"
                    onClick={() =>
                      onNavigate(
                        "expenses",
                        c.expense_id || "trip:" + c.trip_id,
                      )
                    }
                  >
                    Open source
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <p>No unbilled customer charges.</p>}
      <div className="actions">
        <strong>
          Selected:{" "}
          {money(selected.reduce((n, c) => n + Number(c.amount_minor), 0))}
        </strong>
        <button
          className="primary"
          disabled={busy || !picked.length || picked.length > 200}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const d = await request<{ id: string }>(
                "invoices/from-charges",
                "POST",
                { client_id: clientId, charge_ids: picked },
                await requestKey(),
              );
              notify("Draft created; full charges reserved.");
              onNavigate("sales", d.id);
            } catch (e) {
              setError((e as Error).message);
              await load();
              setPicked([]);
            } finally {
              setBusy(false);
            }
          }}
        >
          Create draft from charges
        </button>
      </div>
    </section>
  );
}
