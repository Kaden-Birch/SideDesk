"use client";
import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type FormEvent,
} from "react";
import {
  request,
  requestKey,
  duration,
  type Client,
  type Contact,
  type Settings,
} from "@/lib/client";
import { AddChargesButton } from "@/features/expenses/ChargesQueue";
import { todayIn, daysAfter as dueDate } from "@/lib/dates";
import DocumentEmail from "@/features/email/DocumentEmail";
import CreditsPanel from "./CreditsPanel";
import QuoteOrigin from "./QuoteOrigin";
import TaxControls, { useTaxProfiles, DocumentTaxPicker } from "./TaxControls";
import { Dialog, Field, Tag } from "@/components/ui";
import { money, parseDecimal } from "./money";
import type { TaxComponent } from "./taxes";
import type { Invoice, Line, Source, Payment } from "./model";
type EditorLine = {
  key: string;
  kind: "manual" | "time" | "charge";
  charge_id?: string;
  tax_components?: TaxComponent[];
  tax_treatment?: "taxable" | "zero" | "exempt";
  description: string;
  quantity: string;
  unit: string;
  discount: string;
  tax: string;
  tax_label: string;
  sources: Source[];
};
const manual = (): EditorLine => ({
  key: Math.random().toString(36),
  kind: "manual",
  description: "",
  quantity: "1",
  unit: "0.00",
  discount: "0",
  tax: "0",
  tax_label: "Tax",
  sources: [],
});
function fromLine(l: Line): EditorLine {
  return {
    key: l.id,
    kind: l.kind,
    description: l.description,
    quantity: String(Number(l.quantity)),
    unit: (l.unit_minor / 100).toFixed(2),
    discount: (l.discount_bps / 100).toFixed(2),
    tax: (l.tax_bps / 100).toFixed(2),
    tax_label: l.tax_label,
    sources: l.source_snapshot,
    charge_id: l.charge_snapshot?.[0]?.id,
    tax_components:
      l.tax_bps === 0 && l.tax_snapshot?.some((t) => t.rate_milli_percent > 0)
        ? l.tax_snapshot.map(({ label, rate_milli_percent, compound }) => ({
            label,
            rate_milli_percent,
            compound,
          }))
        : undefined,
    tax_treatment: l.tax_treatment,
  };
}
export function groupSources(sources: Source[]): EditorLine[] {
  const groups = new Map<string, Source[]>();
  for (const s of sources) {
    const k = JSON.stringify([
      s.job_id,
      s.rate_minor,
      s.rounding_minutes,
      s.rounding_scope,
    ]);
    groups.set(k, [...(groups.get(k) || []), s]);
  }
  return [...groups.values()].map((g) => ({
    ...manual(),
    kind: "time" as const,
    description:
      g[0].job_title ||
      (g.length === 1 ? g[0].title : `Client work - ${g.length} entries`),
    unit: (Number(g[0].rate_minor) / 100).toFixed(2),
    sources: g,
  }));
}
export default function InvoiceEditor({
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
  const createKey = useRef<string | null>(null),
    paymentKey = useRef<string | null>(null);
  const taxProfiles = useTaxProfiles();
  const [invoice, setInvoice] = useState<Invoice | null>(null),
    [clientId, setClientId] = useState(clients[0]?.id || ""),
    [contactId, setContactId] = useState(""),
    [contacts, setContacts] = useState<Contact[]>([]),
    [issueDate, setIssueDate] = useState(() => todayIn(settings.timezone)),
    [due, setDue] = useState(() => dueDate(todayIn(settings.timezone))),
    [paper, setPaper] = useState<"A4" | "Letter">("Letter"),
    [notes, setNotes] = useState(""),
    [terms, setTerms] = useState(settings.invoice_terms),
    [lines, setLines] = useState<EditorLine[]>(() => [manual()]),
    [dirty, setDirty] = useState(recordId === "new"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dialog, setDialog] = useState<
      "sources" | "payment" | "reverse" | "void" | null
    >(null),
    [sources, setSources] = useState<Source[]>([]),
    [picked, setPicked] = useState<string[]>([]),
    [receipt, setReceipt] = useState<Payment | null>(null);
  const load = useCallback(async () => {
    if (recordId === "new") return;
    const i = await request<Invoice>("invoices/" + recordId);
    setInvoice(i);
    setClientId(i.client_id);
    setContactId(i.client_snapshot.contact_id || "");
    setIssueDate(i.issue_date);
    setDue(i.due_date);
    setPaper(i.paper);
    setNotes(i.notes);
    setTerms(i.terms);
    setLines(i.lines.map(fromLine));
    setDirty(false);
  }, [recordId]);
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    if (clientId)
      void request<{ contacts: Contact[] }>("clients/" + clientId)
        .then((c) => setContacts(c.contacts))
        .catch((e) => setError(e.message));
  }, [clientId]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  function changeLine(index: number, change: Partial<EditorLine>) {
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...change } : l)));
    setDirty(true);
  }
  function swap(index: number, direction: number) {
    setLines((ls) => {
      const copy = [...ls];
      [copy[index], copy[index + direction]] = [
        copy[index + direction],
        copy[index],
      ];
      return copy;
    });
    setDirty(true);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const body = {
        client_id: clientId,
        contact_id: contactId || null,
        issue_date: issueDate,
        due_date: due,
        paper,
        notes,
        terms,
        lines: lines.map((l) => {
          const common = {
            kind: l.kind,
            description: l.description,
            discount_bps: parseDecimal(l.discount),
            tax_bps: parseDecimal(l.tax),
            ...(l.tax_components ? { tax_components: l.tax_components } : {}),
            tax_treatment: l.tax_treatment || "taxable",
            tax_label: l.tax_label,
          };
          return l.kind === "manual"
            ? {
                ...common,
                quantity: l.quantity,
                unit_minor: parseDecimal(l.unit),
              }
            : l.kind === "charge"
              ? { ...common, charge_id: l.charge_id }
              : { ...common, source_ids: l.sources.map((s) => s.id) };
        }),
        ...(invoice ? { version: invoice.version } : {}),
      };
      const result = await request<{ id: string }>(
        "invoices" + (invoice ? "/" + invoice.id : ""),
        invoice ? "PUT" : "POST",
        body,
        invoice ? undefined : (createKey.current ||= await requestKey()),
      );
      notify(
        "Draft saved. Totals were calculated on the server; selected time is reserved.",
      );
      if (!invoice) onNavigate("sales", result.id);
      else await load();
    });
  }
  const editable = !invoice || invoice.state === "draft";
  if (recordId !== "new" && !invoice)
    return <p role="status">Loading invoice… {error}</p>;
  async function openSources() {
    await run(async () => {
      setSources(
        (await request<Source[]>("unbilled")).filter(
          (s) =>
            s.client_id === clientId &&
            !lines.some((l) => l.sources.some((x) => x.id === s.id)),
        ),
      );
      setPicked([]);
      setDialog("sources");
    });
  }
  async function action(kind: "issue" | "discard") {
    await run(async () => {
      if (!invoice) return;
      if (
        !confirm(
          kind === "issue"
            ? "Issue this invoice? Prices, taxes, client details and the PDF will become immutable."
            : "Discard this draft and release its reserved time?",
        )
      )
        return;
      if (kind === "issue") {
        const result = await request<{ number: string }>(
          "invoices/" + invoice.id + "/issue",
          "POST",
          { version: invoice.version },
          await requestKey(),
        );
        await load();
        notify("Invoice " + result.number + " issued. Original PDF preserved.");
      } else {
        await request("invoices/" + invoice.id, "DELETE", {
          version: invoice.version,
        });
        notify("Draft discarded. Time is available to bill again.");
        onNavigate("sales");
      }
    });
  }
  async function paymentForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget),
      get = (k: string) => String(fd.get(k) || "");
    await run(async () => {
      if (!invoice) return;
      if (dialog === "payment") {
        await request(
          "invoices/" + invoice.id + "/payments",
          "POST",
          {
            amount_minor: parseDecimal(get("amount")),
            method: get("method"),
            received_on: get("received_on"),
            reference: get("reference"),
            note: get("note"),
          },
          (paymentKey.current ||= await requestKey()),
        );
        notify("Payment recorded. Issued totals and PDF are unchanged.");
      } else if (dialog === "reverse" && receipt) {
        await request(
          `invoices/${invoice.id}/payments/${receipt.id}/reverse`,
          "POST",
          { reason: get("reason") },
          (paymentKey.current ||= await requestKey()),
        );
        notify("Receipt reversed. Original receipt remains in history.");
      } else if (dialog === "void") {
        await request("invoices/" + invoice.id + "/void", "POST", {
          version: invoice.version,
          reason: get("reason"),
        });
        notify(
          "Invoice voided. Source reservations released; original PDF retained.",
        );
      }
      setDialog(null);
      await load();
    });
  }
  return (
    <>
      <button className="link back" onClick={() => onNavigate("sales")}>
        ← Sales
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">INVOICES</p>
          <h1>{invoice?.number || "Draft invoice"}</h1>
          <Tag>{invoice?.status.replaceAll("_", " ") || "Draft"}</Tag>
        </div>
        <div className="actions">
          {invoice && (
            <>
              <a
                className={`button ${dirty ? "disabled-link" : ""}`}
                href={
                  dirty
                    ? undefined
                    : `/api/invoices/${invoice.id}/pdf?preview=1`
                }
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={dirty}
              >
                Preview PDF
              </a>
              {!editable && (
                <a className="button" href={`/api/invoices/${invoice.id}/pdf`}>
                  Download original PDF
                </a>
              )}
            </>
          )}
          {invoice?.state === "issued" && invoice.balance_minor > 0 && (
            <button
              className="primary"
              onClick={() => (
                (paymentKey.current = null),
                setDialog("payment")
              )}
            >
              Record payment
            </button>
          )}
          {invoice?.state === "issued" &&
            invoice.received_minor === 0 &&
            (invoice.credit_minor || 0) === 0 && (
              <button onClick={() => setDialog("void")}>Void invoice</button>
            )}
        </div>
      </div>
      {error && (
        <p className="alert danger" role="alert">
          {error}
        </p>
      )}
      {dirty && (
        <p className="notice">
          Save your draft to calculate totals and preview the current PDF.
        </p>
      )}
      {invoice?.state === "void" && (
        <p className="alert">
          Voided: {invoice.void_reason}. The downloadable PDF is the unchanged
          original issued document.
        </p>
      )}
      <div className="invoice-layout">
        <section className="card invoice-editor">
          {editable ? (
            <form className="stack" onSubmit={save}>
              <h2>Recipient & dates</h2>
              <div className="form-grid">
                <Field label="Invoice client">
                  <select
                    required
                    value={clientId}
                    disabled={Boolean(invoice?.source_quote_id)}
                    onChange={(e) => {
                      if (
                        lines.some((l) => l.kind !== "manual") &&
                        !confirm(
                          "Changing client removes selected time lines. Continue?",
                        )
                      )
                        return;
                      setClientId(e.target.value);
                      setContactId("");
                      setLines((ls) => ls.filter((l) => l.kind === "manual"));
                      setDirty(true);
                    }}
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Billing contact">
                  <select
                    value={contactId}
                    onChange={(e) => {
                      setContactId(e.target.value);
                      setDirty(true);
                    }}
                  >
                    <option value="">Client billing details</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Invoice date">
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => {
                      setIssueDate(e.target.value);
                      setDirty(true);
                    }}
                    required
                  />
                </Field>
                <Field label="Payment due date">
                  <input
                    type="date"
                    value={due}
                    min={issueDate}
                    onChange={(e) => {
                      setDue(e.target.value);
                      setDirty(true);
                    }}
                    required
                  />
                </Field>
                <Field label="Print paper size">
                  <select
                    value={paper}
                    onChange={(e) => {
                      setPaper(e.target.value as "A4" | "Letter");
                      setDirty(true);
                    }}
                  >
                    <option>Letter</option>
                    <option>A4</option>
                  </select>
                </Field>
              </div>
              <div className="section-heading">
                <h2>Invoice lines</h2>
                <DocumentTaxPicker
                  profiles={taxProfiles}
                  onApply={(p) => {
                    setLines((v) => v.map((l) => ({ ...l, ...p })));
                    setDirty(true);
                  }}
                />
                <span className="muted">CAD · tax exclusive</span>
              </div>
              {lines.map((l, index) => (
                <fieldset className="invoice-line-form" key={l.key}>
                  <legend>
                    Line {index + 1} ·{" "}
                    {l.kind === "time"
                      ? "Recorded time"
                      : l.kind === "charge"
                        ? "Expense / travel charge"
                        : "Manual item"}
                  </legend>
                  <Field label={`Line ${index + 1} description`}>
                    <textarea
                      value={l.description}
                      maxLength={500}
                      rows={2}
                      required
                      onChange={(e) =>
                        changeLine(index, { description: e.target.value })
                      }
                    />
                  </Field>
                  {l.kind === "charge" ? (
                    <p className="muted">
                      Full source charge · {money(parseDecimal(l.unit))}. Remove
                      this line to release it.
                    </p>
                  ) : l.kind === "time" ? (
                    <p className="notice">
                      {l.sources.length} full time{" "}
                      {l.sources.length === 1 ? "entry" : "entries"} ·{" "}
                      {duration(
                        l.sources.reduce((n, s) => n + s.duration_seconds, 0),
                      )}{" "}
                      recorded · {money(Number(l.sources[0].rate_minor))}/h ·
                      round {l.sources[0].rounding_minutes}m per{" "}
                      {l.sources[0].rounding_scope === "group"
                        ? "invoice group"
                        : "entry"}
                      . Review entry rates in Unbilled before adding them.
                    </p>
                  ) : (
                    <div className="form-grid">
                      <Field label={`Line ${index + 1} quantity`}>
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          max="999999.999"
                          value={l.quantity}
                          required
                          onChange={(e) =>
                            changeLine(index, { quantity: e.target.value })
                          }
                        />
                      </Field>
                      <Field label={`Line ${index + 1} unit rate (CAD)`}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          max="10000000"
                          value={l.unit}
                          required
                          onChange={(e) =>
                            changeLine(index, { unit: e.target.value })
                          }
                        />
                      </Field>
                    </div>
                  )}
                  <div className="form-grid">
                    <Field label={`Line ${index + 1} discount (%)`}>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        required
                        value={l.discount}
                        onChange={(e) =>
                          changeLine(index, { discount: e.target.value })
                        }
                      />
                    </Field>
                    <Field
                      label={`Line ${index + 1} tax (%)`}
                      hint={
                        settings.tax_enabled
                          ? "Enter configured tax; no registration is assumed."
                          : "Taxes are disabled in Settings."
                      }
                    >
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        required
                        disabled={
                          Boolean(l.tax_components) ||
                          l.tax_treatment === "zero" ||
                          l.tax_treatment === "exempt" ||
                          (!settings.tax_enabled && Number(l.tax) === 0)
                        }
                        value={l.tax}
                        onChange={(e) =>
                          changeLine(index, { tax: e.target.value })
                        }
                      />
                    </Field>
                    {settings.tax_enabled && (
                      <Field label={`Line ${index + 1} tax label`}>
                        <input
                          maxLength={60}
                          disabled={
                            Boolean(l.tax_components) ||
                            l.tax_treatment === "zero" ||
                            l.tax_treatment === "exempt"
                          }
                          value={l.tax_label}
                          onChange={(e) =>
                            changeLine(index, { tax_label: e.target.value })
                          }
                        />
                      </Field>
                    )}
                  </div>
                  <TaxControls
                    prefix={`Line ${index + 1}`}
                    profiles={taxProfiles}
                    components={l.tax_components}
                    treatment={l.tax_treatment}
                    onChange={(p) => changeLine(index, p)}
                  />
                  <div className="actions">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => swap(index, -1)}
                    >
                      Move line {index + 1} up
                    </button>
                    <button
                      type="button"
                      disabled={index === lines.length - 1}
                      onClick={() => swap(index, 1)}
                    >
                      Move line {index + 1} down
                    </button>
                    <button
                      type="button"
                      className="danger-text"
                      onClick={() => {
                        setLines((ls) => ls.filter((_, i) => i !== index));
                        setDirty(true);
                      }}
                    >
                      Remove line {index + 1}
                    </button>
                  </div>
                </fieldset>
              ))}
              <div className="actions">
                <button
                  type="button"
                  disabled={lines.length >= 200}
                  onClick={() => {
                    setLines((ls) => [...ls, manual()]);
                    setDirty(true);
                  }}
                >
                  Add manual line
                </button>
                <button
                  type="button"
                  disabled={!clientId}
                  onClick={() => void openSources()}
                >
                  Add unbilled time
                </button>
                <AddChargesButton
                  clientId={clientId}
                  exclude={lines.flatMap((l) =>
                    l.charge_id ? [l.charge_id] : [],
                  )}
                  onAdd={(charges) => {
                    setLines((v) => [
                      ...v,
                      ...charges.map((c) => ({
                        ...manual(),
                        kind: "charge" as const,
                        description: c.description,
                        unit: (Number(c.amount_minor) / 100).toFixed(2),
                        charge_id: c.id,
                      })),
                    ]);
                    setDirty(true);
                  }}
                />
              </div>
              <Field label="Customer-visible notes">
                <textarea
                  maxLength={4000}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              <Field label="Invoice terms">
                <textarea
                  maxLength={4000}
                  value={terms}
                  onChange={(e) => {
                    setTerms(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy || !lines.length || !clients.length}
                >
                  {busy ? "Working…" : "Save draft"}
                </button>
                {invoice && (
                  <>
                    <button
                      type="button"
                      disabled={busy || dirty}
                      onClick={() => void action("issue")}
                    >
                      Issue invoice
                    </button>
                    <button
                      type="button"
                      className="danger-text"
                      disabled={busy}
                      onClick={() => void action("discard")}
                    >
                      Discard draft
                    </button>
                  </>
                )}
              </div>
            </form>
          ) : (
            <>
              <div className="form-grid">
                <section>
                  <h2>From</h2>
                  <strong>{invoice!.issuer_snapshot.name}</strong>
                  <p className="preserve">{invoice!.issuer_snapshot.address}</p>
                </section>
                <section>
                  <h2>Bill to</h2>
                  <strong>{invoice!.client_snapshot.name}</strong>
                  <p>{invoice!.client_snapshot.contact}</p>
                  <p className="preserve">{invoice!.client_snapshot.address}</p>
                </section>
              </div>
              <p>
                Issued {invoice!.issue_date} · Due {invoice!.due_date} · CAD
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Quantity</th>
                      <th>Rate</th>
                      <th>Tax</th>
                      <th>Total CAD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice!.lines.map((l) => (
                      <tr key={l.id}>
                        <td>
                          {l.description}
                          {l.kind === "time" && (
                            <small className="block">
                              {duration(l.original_seconds || 0)} recorded /{" "}
                              {duration(l.billable_seconds || 0)} billed
                            </small>
                          )}
                        </td>
                        <td>
                          {l.kind === "time"
                            ? String((l.billable_seconds || 0) / 60) + " min"
                            : Number(l.quantity).toString()}
                        </td>
                        <td>{money(l.unit_minor)}</td>
                        <td>
                          {l.tax_label} {l.tax_bps / 100}%
                        </td>
                        <td>{money(l.total_minor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>Notes & terms</h3>
              <p className="preserve">{invoice!.notes}</p>
              <p className="preserve">{invoice!.terms}</p>
              <p className="muted">
                Issued prices, taxes, identity and PDF are frozen. Later
                payments change only the live balance.
              </p>
            </>
          )}
        </section>
        <aside className="stack" aria-label="Invoice totals and history">
          <section className="card invoice-summary">
            <h2>{editable ? "Saved totals" : "Invoice balance"}</h2>
            {invoice ? (
              <>
                <div className="sum">
                  <span>Subtotal</span>
                  <strong>{money(invoice.subtotal_minor)}</strong>
                </div>
                <div className="sum">
                  <span>Discounts</span>
                  <strong>-{money(invoice.discount_minor)}</strong>
                </div>
                <div className="sum">
                  <span>Tax</span>
                  <strong>{money(invoice.tax_minor)}</strong>
                </div>
                <div className="sum grand">
                  <span>Total CAD</span>
                  <strong>{money(invoice.total_minor)}</strong>
                </div>
                <div className="sum">
                  <span>Net received</span>
                  <strong>{money(invoice.received_minor)}</strong>
                </div>
                <div className="sum balance">
                  <span>
                    {invoice.state === "void"
                      ? "Outstanding (voided)"
                      : "Outstanding"}
                  </span>
                  <strong>{money(invoice.balance_minor)}</strong>
                </div>
              </>
            ) : (
              <p className="muted">
                Save the draft to calculate exact amounts on the server.
              </p>
            )}
            {invoice?.pdf_sha256 && (
              <small className="block hash">
                Original PDF SHA-256
                <br />
                {invoice.pdf_sha256}
              </small>
            )}
          </section>
          {invoice && (
            <>
              <section className="card">
                <h2>Payments & corrections</h2>
                {invoice.payments.length ? (
                  invoice.payments.map((p) => (
                    <div className="payment-row" key={p.id}>
                      <Tag>{p.kind}</Tag>
                      <strong>
                        {p.kind === "reversal" ? "-" : ""}
                        {money(p.amount_minor)}
                      </strong>
                      <small>
                        {p.received_on} · {p.method.replaceAll("_", " ")}
                      </small>
                      <p>
                        {p.reference} {p.note}
                      </p>
                      {p.kind === "receipt" &&
                        invoice.state === "issued" &&
                        !invoice.payments.some(
                          (x) => x.reverses_id === p.id,
                        ) && (
                          <button
                            onClick={() => {
                              setReceipt(p);
                              paymentKey.current = null;
                              setDialog("reverse");
                            }}
                          >
                            Reverse receipt
                          </button>
                        )}
                    </div>
                  ))
                ) : (
                  <p className="muted">No payments recorded.</p>
                )}
                <small>
                  Reversal corrects an erroneous receipt. Credits and external
                  refunds are recorded separately below.
                </small>
              </section>
              <section className="card">
                <h2>Invoice history</h2>
                {invoice.events.map((e) => (
                  <div className="history-event" key={e.id}>
                    <strong>{e.type.replaceAll("_", " ")}</strong>
                    <p>{e.summary}</p>
                    <small>
                      {new Date(e.created_at).toLocaleString("en-CA", {
                        timeZone: settings.timezone,
                        hourCycle: "h23",
                        year: "numeric",
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </div>
                ))}
              </section>
            </>
          )}
          {invoice?.source_quote_id && (
            <QuoteOrigin invoice={invoice} onNavigate={onNavigate} />
          )}
          {invoice && invoice.state !== "draft" && (
            <>
              <CreditsPanel
                invoice={invoice}
                timezone={settings.timezone}
                onChanged={load}
                notify={notify}
              />
              <DocumentEmail
                timezone={settings.timezone}
                canSend={invoice.state === "issued"}
                kind="invoice"
                id={invoice.id}
                recipient={invoice.client_snapshot.email}
                number={invoice.number!}
                onSent={load}
                notify={notify}
              />
            </>
          )}
        </aside>
      </div>
      {dialog && (
        <Dialog
          title={
            {
              sources: "Add unbilled time",
              payment: "Record payment",
              reverse: "Reverse receipt",
              void: "Void issued invoice",
            }[dialog]
          }
          drawer={dialog !== "sources"}
          onClose={() => {
            setDialog(null);
            setError("");
          }}
        >
          {error && (
            <p role="alert" className="alert danger">
              {error}
            </p>
          )}
          {dialog === "sources" ? (
            <div className="stack">
              {sources.length ? (
                sources.map((s) => (
                  <label className="check" key={s.id}>
                    <input
                      type="checkbox"
                      checked={picked.includes(s.id)}
                      onChange={(e) =>
                        setPicked((v) =>
                          e.target.checked
                            ? [...v, s.id]
                            : v.filter((id) => id !== s.id),
                        )
                      }
                    />
                    {s.title} · {duration(s.duration_seconds)} ·{" "}
                    {money(s.rate_minor)}/h · {s.rounding_scope}
                  </label>
                ))
              ) : (
                <p>No additional billable time is available for this client.</p>
              )}
              <button
                className="primary"
                disabled={!picked.length}
                onClick={() => {
                  setLines((ls) => [
                    ...ls.filter(
                      (l) => l.kind !== "manual" || l.description.trim(),
                    ),
                    ...groupSources(
                      sources.filter((s) => picked.includes(s.id)),
                    ),
                  ]);
                  setDirty(true);
                  setDialog(null);
                }}
              >
                Add selected time
              </button>
            </div>
          ) : (
            <form className="stack" onSubmit={paymentForm}>
              {dialog === "payment" ? (
                <>
                  <p>
                    Outstanding:{" "}
                    <strong>{money(invoice!.balance_minor)} CAD</strong>
                  </p>
                  <Field label="Payment amount (CAD)">
                    <input
                      type="number"
                      name="amount"
                      min="0.01"
                      max={(invoice!.balance_minor / 100).toFixed(2)}
                      step="0.01"
                      defaultValue={(invoice!.balance_minor / 100).toFixed(2)}
                      required
                    />
                  </Field>
                  <Field label="Payment method">
                    <select name="method">
                      <option value="e_transfer">E-transfer</option>
                      <option value="cash">Cash</option>
                      <option value="cheque">Cheque</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                  <Field label="Received date">
                    <input
                      name="received_on"
                      type="date"
                      defaultValue={todayIn(settings.timezone)}
                      required
                    />
                  </Field>
                  <Field label="Payment reference">
                    <input name="reference" maxLength={160} />
                  </Field>
                  <Field label="Payment note">
                    <textarea name="note" maxLength={1000} />
                  </Field>
                </>
              ) : (
                <>
                  <p>
                    {dialog === "reverse"
                      ? `This adds a full reversal of ${money(receipt!.amount_minor)} and preserves the original receipt.`
                      : "This preserves the original document and number, and releases its source charges for rebilling. Net cash receipts and credits must both be zero."}
                  </p>
                  <Field label="Correction reason">
                    <textarea name="reason" maxLength={500} required />
                  </Field>
                </>
              )}
              <button className="primary" disabled={busy}>
                {busy
                  ? "Working…"
                  : dialog === "payment"
                    ? "Save payment"
                    : dialog === "reverse"
                      ? "Confirm receipt reversal"
                      : "Confirm void"}
              </button>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
