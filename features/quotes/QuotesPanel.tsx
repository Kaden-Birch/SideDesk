"use client";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import {
  request,
  requestKey,
  type Client,
  type Contact,
  type Settings,
} from "@/lib/client";
import { todayIn, daysAfter } from "@/lib/dates";
import { Dialog, Field, Tag, Empty } from "@/components/ui";
import { money, parseDecimal } from "@/features/billing/money";
import TaxControls, {
  useTaxProfiles,
  DocumentTaxPicker,
} from "@/features/billing/TaxControls";
import type { TaxComponent } from "@/features/billing/taxes";
import type { Line } from "@/features/billing/model";
import DocumentEmail from "@/features/email/DocumentEmail";
import type { Quote } from "./service";
type Props = {
  clients: Client[];
  settings: Settings;
  recordId: string;
  onNavigate: (view: string, id?: string) => void;
  notify: (s: string) => void;
};
type EditorLine = {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  discount: string;
  tax: string;
  tax_label: string;
  tax_components?: TaxComponent[];
  tax_treatment: "taxable" | "zero" | "exempt";
};
const blank = (): EditorLine => ({
  key: Math.random().toString(36),
  description: "",
  quantity: "1",
  unit: "0.00",
  discount: "0",
  tax: "0",
  tax_label: "Tax",
  tax_treatment: "taxable",
});
function fromLine(l: Line): EditorLine {
  return {
    key: l.id,
    description: l.description,
    quantity: String(Number(l.quantity)),
    unit: (l.unit_minor / 100).toFixed(2),
    discount: (l.discount_bps / 100).toFixed(2),
    tax: (l.tax_bps / 100).toFixed(2),
    tax_label: l.tax_label,
    tax_components:
      l.tax_bps === 0 && l.tax_snapshot?.some((t) => t.rate_milli_percent > 0)
        ? l.tax_snapshot.map(({ label, rate_milli_percent, compound }) => ({
            label,
            rate_milli_percent,
            compound,
          }))
        : undefined,
    tax_treatment: l.tax_treatment || "taxable",
  };
}
function QuoteEditor({
  clients,
  settings,
  recordId,
  onNavigate,
  notify,
}: Props) {
  const createKey = useRef<string | null>(null);
  const taxProfiles = useTaxProfiles();
  const [quote, setQuote] = useState<Quote | null>(null),
    [clientId, setClientId] = useState(clients[0]?.id || ""),
    [contacts, setContacts] = useState<Contact[]>([]),
    [contactId, setContactId] = useState(""),
    [date, setDate] = useState(todayIn(settings.timezone)),
    [expiry, setExpiry] = useState(daysAfter(todayIn(settings.timezone))),
    [paper, setPaper] = useState<"Letter" | "A4">("Letter"),
    [notes, setNotes] = useState(""),
    [terms, setTerms] = useState(""),
    [lines, setLines] = useState<EditorLine[]>([blank()]),
    [dirty, setDirty] = useState(recordId === "new"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [decision, setDecision] = useState<"accepted" | "declined" | "void" | null>(
      null,
    );
  const load = useCallback(async () => {
    if (recordId === "new") return;
    const q = await request<Quote>("quotes/" + recordId);
    setQuote(q);
    setClientId(q.client_id);
    setContactId(
      (q.document.client as typeof q.document.client & { contact_id?: string })
        .contact_id || "",
    );
    setDate(q.issue_date);
    setExpiry(q.expiry_date);
    setPaper(q.document.paper);
    setNotes(q.document.notes);
    setTerms(q.document.terms);
    setLines(q.document.lines.map(fromLine));
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
  const editable = !quote || quote.state === "draft";
  function change(index: number, value: Partial<EditorLine>) {
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...value } : l)));
    setDirty(true);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const p = {
        client_id: clientId,
        contact_id: contactId || null,
        issue_date: date,
        expiry_date: expiry,
        paper,
        notes,
        terms,
        lines: lines.map((l) => ({
          kind: "manual",
          description: l.description,
          quantity: l.quantity,
          unit_minor: parseDecimal(l.unit),
          discount_bps: parseDecimal(l.discount),
          tax_bps: parseDecimal(l.tax),
          tax_label: l.tax_label,
          ...(l.tax_components ? { tax_components: l.tax_components } : {}),
          tax_treatment: l.tax_treatment,
        })),
      };
      const r = await request<{ id: string }>(
        "quotes" + (quote ? "/" + quote.id : ""),
        quote ? "PUT" : "POST",
        { ...p, ...(quote ? { version: quote.version } : {}) },
        quote ? undefined : (createKey.current ||= await requestKey()),
      );
      notify("Quote draft saved with exact server totals.");
      if (quote) await load();
      else onNavigate("quotes", r.id);
    });
  }
  async function publish() {
    await run(async () => {
      if (
        !quote ||
        !confirm(
          "Publish this quote? Its parties, prices, taxes and PDF become immutable. Email and acceptance are separate actions.",
        )
      )
        return;
      await request(
        "quotes/" + quote.id + "/publish",
        "POST",
        { version: quote.version },
        await requestKey(),
      );
      await load();
      notify("Quote published. It has not been emailed.");
    });
  }
  async function convert(target: "job" | "invoice") {
    await run(async () => {
      if (!quote) return;
      const r = await request<{ id: string }>(
        "quotes/" + quote.id + "/convert",
        "POST",
        { target },
        await requestKey(),
      );
      onNavigate(target === "invoice" ? "sales" : "jobs", r.id);
    });
  }
  if (recordId !== "new" && !quote)
    return <p role="status">Loading quote… {error}</p>;
  const doc = quote?.document;
  return (
    <>
      <button className="link" onClick={() => onNavigate("quotes")}>
        ← Quotes
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SALES / QUOTES</p>
          <h1>{quote?.number || "Draft quote"}</h1>
          <Tag>{quote?.status || "draft"}</Tag>
        </div>
        {quote && (
          <div className="actions">
            <a
              className="button"
              href={`/api/quotes/${quote.id}/pdf?preview=1`}
              target="_blank"
              rel="noreferrer"
            >
              Preview quote PDF
            </a>
            {!editable && (
              <a
                className="button primary"
                href={`/api/quotes/${quote.id}/pdf`}
              >
                Download original quote PDF
              </a>
            )}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="alert danger">
          {error}
        </p>
      )}
      <div className="invoice-layout">
        <div>
          {editable ? (
            <form className="card" onSubmit={save}>
              <h2>Recipient & dates</h2>
              <div className="form-grid">
                <Field label="Quote client">
                  <select
                    required
                    value={clientId}
                    onChange={(e) => {
                      setClientId(e.target.value);
                      setContactId("");
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
                <Field label="Quote billing contact">
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
                <Field label="Quote date">
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setDirty(true);
                    }}
                  />
                </Field>
                <Field label="Quote expiry date">
                  <input
                    type="date"
                    required
                    min={date}
                    value={expiry}
                    onChange={(e) => {
                      setExpiry(e.target.value);
                      setDirty(true);
                    }}
                  />
                </Field>
                <Field label="Quote paper size">
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
              <h2>Proposed scope & prices</h2>
              <DocumentTaxPicker
                profiles={taxProfiles}
                onApply={(p) => {
                  setLines((v) => v.map((l) => ({ ...l, ...p })));
                  setDirty(true);
                }}
              />
              {lines.map((l, index) => (
                <fieldset className="invoice-line" key={l.key}>
                  <legend>Quote line {index + 1}</legend>
                  <Field label={`Quote line ${index + 1} description`}>
                    <textarea
                      required
                      maxLength={500}
                      value={l.description}
                      onChange={(e) =>
                        change(index, { description: e.target.value })
                      }
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label={`Quote line ${index + 1} quantity`}>
                      <input
                        required
                        type="number"
                        min="0.001"
                        max="999999.999"
                        step="0.001"
                        value={l.quantity}
                        onChange={(e) =>
                          change(index, { quantity: e.target.value })
                        }
                      />
                    </Field>
                    <Field label={`Quote line ${index + 1} unit rate (CAD)`}>
                      <input
                        required
                        type="number"
                        min="0"
                        max="10000000"
                        step="0.01"
                        value={l.unit}
                        onChange={(e) =>
                          change(index, { unit: e.target.value })
                        }
                      />
                    </Field>
                    <Field label={`Quote line ${index + 1} discount (%)`}>
                      <input
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={l.discount}
                        onChange={(e) =>
                          change(index, { discount: e.target.value })
                        }
                      />
                    </Field>
                    <Field label={`Quote line ${index + 1} tax (%)`}>
                      <input
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={l.tax}
                        disabled={
                          Boolean(l.tax_components) ||
                          l.tax_treatment !== "taxable" ||
                          (!settings.tax_enabled && Number(l.tax) === 0)
                        }
                        onChange={(e) => change(index, { tax: e.target.value })}
                      />
                    </Field>
                    <Field label={`Quote line ${index + 1} tax label`}>
                      <input
                        maxLength={60}
                        value={l.tax_label}
                        disabled={
                          Boolean(l.tax_components) ||
                          l.tax_treatment !== "taxable"
                        }
                        onChange={(e) =>
                          change(index, { tax_label: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <TaxControls
                    prefix={`Quote line ${index + 1}`}
                    profiles={taxProfiles}
                    components={l.tax_components}
                    treatment={l.tax_treatment}
                    onChange={(p) => change(index, p)}
                  />
                  <div className="actions">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => {
                        setLines((v) => {
                          const a = [...v];
                          [a[index - 1], a[index]] = [a[index], a[index - 1]];
                          return a;
                        });
                        setDirty(true);
                      }}
                    >
                      Move quote line {index + 1} up
                    </button>
                    <button
                      type="button"
                      disabled={index === lines.length - 1}
                      onClick={() => {
                        setLines((v) => {
                          const a = [...v];
                          [a[index + 1], a[index]] = [a[index], a[index + 1]];
                          return a;
                        });
                        setDirty(true);
                      }}
                    >
                      Move quote line {index + 1} down
                    </button>
                    <button
                      type="button"
                      disabled={lines.length === 1}
                      onClick={() => {
                        setLines((v) => v.filter((_, i) => i !== index));
                        setDirty(true);
                      }}
                    >
                      Remove quote line {index + 1}
                    </button>
                  </div>
                </fieldset>
              ))}
              <button
                type="button"
                disabled={lines.length >= 200}
                onClick={() => {
                  setLines((v) => [...v, blank()]);
                  setDirty(true);
                }}
              >
                Add quote line
              </button>
              <Field label="Quote notes">
                <textarea
                  rows={4}
                  maxLength={4000}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              <Field label="Quote terms">
                <textarea
                  rows={4}
                  maxLength={4000}
                  value={terms}
                  onChange={(e) => {
                    setTerms(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              {dirty && (
                <p className="notice">
                  Save to update exact totals and the PDF preview.
                </p>
              )}
              <div className="actions">
                <button className="primary" disabled={busy}>
                  Save quote draft
                </button>
                <button
                  type="button"
                  disabled={busy || dirty || !quote}
                  onClick={() => void publish()}
                >
                  Publish quote
                </button>
                {quote && (
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (!confirm("Discard this draft quote?")) return;
                        await request("quotes/" + quote.id, "DELETE", {
                          version: quote.version,
                        });
                        onNavigate("quotes");
                      })
                    }
                  >
                    Discard quote draft
                  </button>
                )}
              </div>
            </form>
          ) : (
            doc && (
              <section className="card">
                <h2>Published quote snapshot</h2>
                <p>
                  <strong>{doc.client.name}</strong>
                  <br />
                  {doc.client.contact}
                  <br />
                  {doc.client.address}
                </p>
                <p>
                  {quote?.issue_date} · Valid until {quote?.expiry_date}
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Proposed scope</th>
                        <th>Quantity</th>
                        <th>Unit CAD</th>
                        <th>Tax</th>
                        <th>Total CAD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.lines.map((l) => (
                        <tr key={l.id}>
                          <td>{l.description}</td>
                          <td>{Number(l.quantity)}</td>
                          <td>{money(l.unit_minor)}</td>
                          <td>
                            {l.tax_treatment === "exempt"
                              ? "Exempt"
                              : l.tax_treatment === "zero"
                                ? "Zero-rated"
                                : l.tax_snapshot
                                    ?.map(
                                      (t) =>
                                        `${t.label} ${t.rate_milli_percent / 1000}%`,
                                    )
                                    .join(" + ") || l.tax_label}
                          </td>
                          <td>{money(l.total_minor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {doc.notes && (
                  <>
                    <h3>Notes</h3>
                    <p className="preserve">{doc.notes}</p>
                  </>
                )}
                {doc.terms && (
                  <>
                    <h3>Terms</h3>
                    <p className="preserve">{doc.terms}</p>
                  </>
                )}
                {quote?.decision_note && (
                  <p className="notice">
                    Decision record: {quote.decision_note}
                  </p>
                )}
                <div className="actions">
                  {quote &&
                    ["published", "sent"].includes(quote.state) &&
                    quote.status !== "expired" && (
                      <>
                        <button
                          className="primary"
                          onClick={() => setDecision("accepted")}
                        >
                          Record acceptance
                        </button>
                        <button onClick={() => setDecision("declined")}>
                          Record decline
                        </button>
                      </>
                    )}
                  {quote &&
                    !["void", "declined"].includes(quote.state) &&
                    !quote.invoice_id &&
                    !quote.job_id && (
                      <button onClick={() => setDecision("void")}>
                        Void quote
                      </button>
                    )}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await request<{ id: string }>(
                          "quotes/" + quote!.id + "/revise",
                          "POST",
                          {},
                          await requestKey(),
                        );
                        onNavigate("quotes", r.id);
                      })
                    }
                  >
                    Create quote revision
                  </button>
                </div>
                {quote?.state === "accepted" && (
                  <div className="actions">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        quote.invoice_id
                          ? onNavigate("sales", quote.invoice_id)
                          : void convert("invoice")
                      }
                    >
                      {quote.invoice_id
                        ? "Open linked invoice"
                        : "Create invoice from quote"}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        quote.job_id
                          ? onNavigate("jobs", quote.job_id)
                          : void convert("job")
                      }
                    >
                      {quote.job_id
                        ? "Open linked job"
                        : "Create job from quote"}
                    </button>
                  </div>
                )}
              </section>
            )
          )}
        </div>
        <aside className="stack" aria-label="Quote totals and history">
          <section className="card">
            <h2>Saved quote totals</h2>
            {doc ? (
              <dl className="invoice-summary">
                <div>
                  <dt>Subtotal</dt>
                  <dd>{money(doc.subtotal_minor)}</dd>
                </div>
                <div>
                  <dt>Discounts</dt>
                  <dd>{money(doc.discount_minor)}</dd>
                </div>
                <div>
                  <dt>Tax</dt>
                  <dd>{money(doc.tax_minor)}</dd>
                </div>
                <div className="grand">
                  <dt>Total CAD</dt>
                  <dd>{money(doc.total_minor)}</dd>
                </div>
              </dl>
            ) : (
              <p>Save the draft for exact totals.</p>
            )}
            <p className="muted">
              Quotes propose work; they do not record cash, reserve time or
              issue an invoice.
            </p>
          </section>
          {quote && !editable && (
            <DocumentEmail
              timezone={settings.timezone}
              canSend={["published", "sent", "accepted"].includes(quote.state)}
              kind="quote"
              id={quote.id}
              number={quote.number!}
              recipient={quote.document.client.email}
              onSent={load}
              notify={notify}
            />
          )}
          {quote && (
            <section className="card">
              <h2>Quote history</h2>
              {quote.predecessor_id && (
                <button
                  className="link"
                  onClick={() => onNavigate("quotes", quote.predecessor_id!)}
                >
                  Open previous quote
                </button>
              )}
              {quote.events.map((e) => (
                <div className="history-event" key={e.id}>
                  <strong>{e.type.replaceAll("_", " ")}</strong>
                  <p>{e.summary}</p>
                  <small>
                    {new Date(e.created_at).toLocaleString("en-CA", {
                      timeZone: settings.timezone,
                    })}
                  </small>
                </div>
              ))}
              {quote.pdf_sha256 && (
                <details>
                  <summary>Published PDF checksum</summary>
                  <code className="hash">{quote.pdf_sha256}</code>
                </details>
              )}
            </section>
          )}
        </aside>
      </div>
      {decision && quote && (
        <Dialog
          title={
            decision === "accepted"
              ? "Record quote acceptance"
              : decision === "declined"
                ? "Record quote decline"
                : "Void quote"
          }
          onClose={() => setDecision(null)}
          drawer
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(
                new FormData(e.currentTarget).get("reason"),
              );
              void run(async () => {
                await request("quotes/" + quote.id + "/decision", "POST", {
                  version: quote.version,
                  state: decision,
                  reason,
                });
                setDecision(null);
                await load();
                notify("Quote decision recorded.");
              });
            }}
          >
            <p>
              {decision === "accepted"
                ? "Record how and when the client explicitly accepted. Email acceptance by the SMTP server does not count as client agreement."
                : "Record the reason; the original PDF remains unchanged."}
            </p>
            <Field label="Quote decision evidence or reason">
              <textarea name="reason" required rows={4} maxLength={1000} />
            </Field>
            {error && <p role="alert">{error}</p>}
            <button className="primary" disabled={busy}>
              Confirm quote decision
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
export default function QuotesPanel(props: Props) {
  const [rows, setRows] = useState<Quote[]>([]),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [error, setError] = useState(""),
    [page, setPage] = useState(0);
  useEffect(() => {
    if (!props.recordId)
      void request<Quote[]>("quotes")
        .then(setRows)
        .catch((e) => setError(e.message));
  }, [props.recordId]);
  if (props.recordId) return <QuoteEditor {...props} />;
  const filtered = rows.filter(
    (q) =>
      (status === "all" || q.status === status) &&
      (
        q.client_name +
        " " +
        (q.number || "draft") +
        " " +
        q.document.lines.map((l) => l.description).join(" ")
      )
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SALES / PROPOSALS</p>
          <h1>Quotes</h1>
          <p>Agree the scope and price before creating work or an invoice.</p>
        </div>
        <button
          className="primary"
          disabled={!props.clients.length}
          onClick={() => props.onNavigate("quotes", "new")}
        >
          + New quote
        </button>
      </div>
      <div className="tabs" aria-label="Sales navigation">
        <button onClick={() => props.onNavigate("sales")}>Invoices</button>
        <button className="active" aria-current="page">
          Quotes
        </button>
        <button onClick={() => props.onNavigate("sales", "unbilled")}>
          Unbilled work
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <section className="card">
        <div className="filters">
          <Field label="Search quotes">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </Field>
          <Field label="Quote status">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              {[
                "all",
                "draft",
                "published",
                "sent",
                "accepted",
                "declined",
                "expired",
                "void",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
        {filtered.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Quote</th>
                    <th>Client</th>
                    <th>Status</th>
                    <th>Valid until</th>
                    <th>Total CAD</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(page * 20, page * 20 + 20).map((q) => (
                    <tr key={q.id}>
                      <td>{q.number || "Draft quote"}</td>
                      <td>{q.document.client.name}</td>
                      <td>
                        <Tag>{q.status}</Tag>
                      </td>
                      <td>{q.expiry_date}</td>
                      <td>{money(q.total_minor)}</td>
                      <td>
                        <button
                          onClick={() => props.onNavigate("quotes", q.id)}
                        >
                          Open {q.number || "draft quote"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous quote page
              </button>
              <span>
                Page {page + 1} of{" "}
                {Math.max(1, Math.ceil(filtered.length / 20))}
              </span>
              <button
                disabled={(page + 1) * 20 >= filtered.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Next quote page
              </button>
            </div>
          </>
        ) : (
          <Empty title="No matching quotes">
            <p>Create a draft proposal or adjust your filters.</p>
          </Empty>
        )}
      </section>
    </>
  );
}
