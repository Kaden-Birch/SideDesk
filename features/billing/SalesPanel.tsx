"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  request,
  requestKey,
  duration,
  type Client,
  type Settings,
} from "@/lib/client";
import { Dialog, Field, Tag, Empty } from "@/components/ui";
import type { Invoice, Source, Payment, Job } from "./model";
import { money, parseDecimal, roundSeconds } from "./money";
import InvoiceEditor from "./InvoiceEditor";
type InvoiceRow = Pick<
  Invoice,
  | "id"
  | "client_id"
  | "client_name"
  | "number"
  | "state"
  | "status"
  | "issue_date"
  | "due_date"
  | "total_minor"
  | "received_minor"
  | "balance_minor"
>;
type Receipt = Payment & { number: string; client_name: string };
export default function SalesPanel({
  clients,
  settings,
  recordId,
  onNavigate,
  notify,
}: {
  clients: Client[];
  settings: Settings;
  recordId: string;
  onNavigate: (v: string, id?: string) => void;
  notify: (s: string) => void;
}) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [receipts, setReceipts] = useState<Receipt[]>([]),
    [tab, setTab] = useState(recordId === "unbilled" ? "unbilled" : "invoices"),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [clientId, setClientId] = useState("all"),
    [picked, setPicked] = useState<string[]>([]),
    [review, setReview] = useState<Source | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(0);
  const load = useCallback(async () => {
    const [i, s, p] = await Promise.all([
      request<InvoiceRow[]>("invoices"),
      request<Source[]>("unbilled"),
      request<Receipt[]>("payments"),
    ]);
    setInvoices(i);
    setSources(s);
    setReceipts(p);
    setPicked((v) => v.filter((id) => s.some((x) => x.id === id)));
  }, []);
  useEffect(() => {
    if (!recordId || recordId === "unbilled")
      void Promise.resolve()
        .then(load)
        .catch((e) => setError(e.message));
  }, [load, recordId]);
  async function createFromTime() {
    setBusy(true);
    setError("");
    try {
      const selected = sources.filter((s) => picked.includes(s.id));
      if (!selected.length) return;
      if (new Set(selected.map((s) => s.client_id)).size !== 1)
        throw new Error("Select time for one client per invoice");
      const result = await request<{ id: string }>(
        "invoices/from-time",
        "POST",
        { client_id: selected[0].client_id, source_ids: picked },
        await requestKey(),
      );
      onNavigate("sales", result.id);
      notify(
        "Draft created with reserved time and server-calculated rounding.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft creation failed");
    } finally {
      setBusy(false);
    }
  }
  if (recordId && recordId !== "unbilled")
    return (
      <InvoiceEditor
        key={recordId}
        clients={clients}
        settings={settings}
        recordId={recordId}
        onNavigate={onNavigate}
        notify={notify}
      />
    );
  const selected = sources.filter((s) => picked.includes(s.id)),
    selectedClient = selected[0]?.client_id;
  const filtered = invoices.filter(
    (i) =>
      (status === "all" || i.status === status) &&
      (i.client_name + " " + (i.number || "draft"))
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SALES & RECEIPTS</p>
          <h1>Sales</h1>
          <p>
            Bill recorded work once. Keep documents and cash receipts distinct.
          </p>
        </div>
        <button
          className="primary"
          disabled={!clients.length}
          onClick={() => onNavigate("sales", "new")}
        >
          + New invoice
        </button>
      </div>
      {error && (
        <p className="alert danger" role="alert">
          {error}
        </p>
      )}
      <div className="tabs" role="tablist" aria-label="Sales sections">
        {[
          ["invoices", "Invoices"],
          ["unbilled", "Unbilled work"],
          ["payments", "Payments"],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setPage(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "invoices" && (
        <>
          <div className="toolbar">
            <input
              aria-label="Search invoices"
              placeholder="Search client or invoice number…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            <select
              aria-label="Invoice status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              {[
                "all",
                "draft",
                "issued",
                "partially_paid",
                "paid",
                "overdue",
                "void",
              ].map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          {filtered.length ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Client</th>
                      <th>Status</th>
                      <th>Due</th>
                      <th>Total CAD</th>
                      <th>Received</th>
                      <th>Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(page * 20, page * 20 + 20).map((i) => (
                      <tr key={i.id}>
                        <td>
                          <button
                            className="link"
                            onClick={() => onNavigate("sales", i.id)}
                          >
                            {i.number || "Draft invoice"}
                          </button>
                        </td>
                        <td>{i.client_name}</td>
                        <td>
                          <Tag>{i.status.replaceAll("_", " ")}</Tag>
                        </td>
                        <td>{i.due_date}</td>
                        <td>{money(i.total_minor)}</td>
                        <td>{money(i.received_minor)}</td>
                        <td>
                          {i.state === "void" ? "—" : money(i.balance_minor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <button disabled={!page} onClick={() => setPage((v) => v - 1)}>
                  Previous
                </button>
                <span>
                  Page {page + 1} of {Math.ceil(filtered.length / 20)}
                </span>
                <button
                  disabled={(page + 1) * 20 >= filtered.length}
                  onClick={() => setPage((v) => v + 1)}
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <Empty title="No matching invoices">
              Create a draft manually or select recorded work from Unbilled
              work.
            </Empty>
          )}
        </>
      )}
      {tab === "unbilled" && (
        <>
          <p className="notice">
            Only stopped, billable and unreserved time appears here. Drafts
            reserve full entries; discarding a draft or voiding an invoice
            releases them. Group rounding is calculated across selected entries
            with the same client, historical job, rate and increment.
          </p>
          <div className="toolbar">
            <select
              aria-label="Unbilled client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="all">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              className="primary"
              disabled={busy || !picked.length}
              onClick={() => void createFromTime()}
            >
              {busy ? "Creating…" : `Create draft (${picked.length} entries)`}
            </button>
            {picked.length > 0 && (
              <button onClick={() => setPicked([])}>Clear selection</button>
            )}
          </div>
          {sources.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Work / client</th>
                    <th>Recorded</th>
                    <th>Billing policy</th>
                    <th>Rate CAD/h</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sources
                    .filter(
                      (s) => clientId === "all" || s.client_id === clientId,
                    )
                    .map((s) => (
                      <tr key={s.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${s.title} time entry ${s.id}`}
                            checked={picked.includes(s.id)}
                            disabled={
                              !!selectedClient && selectedClient !== s.client_id
                            }
                            onChange={(e) =>
                              setPicked((v) =>
                                e.target.checked
                                  ? [...v, s.id]
                                  : v.filter((id) => id !== s.id),
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            className="link"
                            onClick={() => onNavigate("work", s.activity_id)}
                          >
                            {s.title}
                          </button>
                          <small className="block">
                            {clients.find((c) => c.id === s.client_id)?.name ||
                              "Archived client"}
                            {s.job_title ? " / " + s.job_title : ""}
                          </small>
                        </td>
                        <td>{duration(s.duration_seconds)}</td>
                        <td>
                          {s.rounding_minutes}m per {s.rounding_scope}
                          {s.rounding_scope === "entry" && (
                            <small className="block">
                              {duration(
                                roundSeconds(
                                  s.duration_seconds,
                                  s.rounding_minutes,
                                ),
                              )}{" "}
                              billed
                            </small>
                          )}
                        </td>
                        <td>
                          {money(s.rate_minor)}
                          <small className="block">{s.rate_source}</small>
                        </td>
                        <td>
                          <button onClick={() => setReview(s)}>
                            Review billing
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No unbilled time">
              Record billable work, then stop its timer or save a manual
              duration. Existing drafts may already reserve your time.
            </Empty>
          )}
        </>
      )}
      {tab === "payments" &&
        (receipts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Client</th>
                  <th>Date</th>
                  <th>Event</th>
                  <th>Method</th>
                  <th>Amount CAD</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button
                        className="link"
                        onClick={() => onNavigate("sales", p.invoice_id)}
                      >
                        {p.number}
                      </button>
                    </td>
                    <td>{p.client_name}</td>
                    <td>{p.received_on}</td>
                    <td>
                      <Tag>{p.kind}</Tag>
                    </td>
                    <td>{p.method.replaceAll("_", " ")}</td>
                    <td>
                      {p.kind === "reversal" ? "-" : ""}
                      {money(p.amount_minor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No receipts recorded">
            Open an issued invoice to record a payment. Cash received is tracked
            separately from invoice totals.
          </Empty>
        ))}
      {review && (
        <TimeReviewDialog
          entry={review}
          onClose={() => setReview(null)}
          onSaved={async () => {
            setReview(null);
            await load();
            notify("Billing review saved with an audit reason.");
          }}
        />
      )}
    </>
  );
}
export function TimeReviewDialog({
  entry,
  onClose,
  onSaved,
}: {
  entry: { id: string; rate_minor: string; billable: boolean; version: number };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await request("time-entries/" + entry.id, "PUT", {
        version: entry.version,
        rate_minor: parseDecimal(String(fd.get("rate"))),
        billable: fd.has("billable"),
        reason: String(fd.get("reason")),
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Review time-entry billing" drawer onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {error && (
          <p className="alert danger" role="alert">
            {error}
          </p>
        )}
        <p className="muted">
          Only unallocated time can be changed. Existing issued snapshots are
          never rewritten.
        </p>
        <Field label="Entry hourly rate override (CAD)">
          <input
            name="rate"
            type="number"
            min="0"
            max="1000000"
            step="0.01"
            defaultValue={(Number(entry.rate_minor) / 100).toFixed(2)}
            required
          />
        </Field>
        <label className="check">
          <input
            name="billable"
            type="checkbox"
            defaultChecked={entry.billable}
          />
          Billable
        </label>
        <Field label="Billing correction reason">
          <textarea name="reason" maxLength={500} required />
        </Field>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save billing review"}
        </button>
      </form>
    </Dialog>
  );
}
export function ClientBillingLinks({
  clientId,
  onNavigate,
}: {
  clientId: string;
  onNavigate: (v: string, id?: string) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]),
    [invoices, setInvoices] = useState<InvoiceRow[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([
      request<Job[]>("jobs"),
      request<InvoiceRow[]>("invoices"),
    ])
      .then(([j, i]) => {
        setJobs(j.filter((x) => x.client_id === clientId));
        setInvoices(i.filter((x) => x.client_id === clientId));
      })
      .catch((e) => setError(e.message));
  }, [clientId]);
  return (
    <section className="card">
      <h2>Jobs & invoices</h2>
      {error && <p role="alert">{error}</p>}
      {jobs.map((j) => (
        <p key={j.id}>
          <button className="link" onClick={() => onNavigate("jobs", j.id)}>
            {j.title} · {j.status.replaceAll("_", " ")}
          </button>
        </p>
      ))}
      {invoices.map((i) => (
        <p key={i.id}>
          <button className="link" onClick={() => onNavigate("sales", i.id)}>
            {i.number || "Draft invoice"} · {money(i.total_minor)} ·{" "}
            {i.status.replaceAll("_", " ")}
          </button>
        </p>
      ))}
      {!jobs.length && !invoices.length && (
        <p className="muted">No structured jobs or invoices yet.</p>
      )}
    </section>
  );
}
export function BillingOverview({
  onNavigate,
}: {
  onNavigate: (v: string, id?: string) => void;
}) {
  const [summary, setSummary] = useState<{
      received_month_minor: number;
      outstanding_minor: number;
      unbilled_seconds: number;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void request<typeof summary>("billing-summary")
      .then(setSummary)
      .catch((e) => setError(e.message));
  }, []);
  if (error)
    return (
      <p className="alert danger" role="alert">
        {error}
      </p>
    );
  if (!summary) return <p role="status">Loading billing summary…</p>;
  return (
    <div className="metrics">
      <div>
        <span>Cash received this month</span>
        <strong>{money(summary.received_month_minor)}</strong>
        <small>Receipts less corrections, CAD</small>
      </div>
      <div>
        <span>Outstanding invoices</span>
        <strong>{money(summary.outstanding_minor)}</strong>
        <small>Issued balance, excludes voids and drafts</small>
      </div>
      <div>
        <span>Unbilled recorded time</span>
        <strong>{duration(summary.unbilled_seconds)}</strong>
        <button
          className="link"
          onClick={() => onNavigate("sales", "unbilled")}
        >
          Review unbilled work →
        </button>
      </div>
    </div>
  );
}
