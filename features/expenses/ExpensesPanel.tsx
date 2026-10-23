"use client";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import Markdown from "react-markdown";
import {
  request,
  requestKey,
  duration,
  type Client,
  type Settings,
} from "@/lib/client";
import { todayIn } from "@/lib/dates";
import { Field, Dialog, Tag, Empty } from "@/components/ui";
import { money, parseDecimal } from "@/features/billing/money";
import type { Job } from "@/features/billing/model";
import JobFiles from "@/features/jobs/JobFiles";
import ChargesQueue from "./ChargesQueue";
import type { Expense, Trip, Charge } from "./service";
type Props = {
  clients: Client[];
  settings: Settings;
  recordId: string;
  onNavigate: (view: string, id?: string) => void;
  notify: (s: string) => void;
};
type CostDetail = (Expense | Trip) & {
  charges: Charge[];
  revisions?: { id: string; reason: string; created_at: string }[];
  notes?: { id: string; body: string }[];
};
const cash = (amount?: number | string) =>
  ((Number(amount) || 0) / 100).toFixed(2);
function CostForm({
  kind,
  record,
  clients,
  jobs,
  settings,
  onClose,
  onSaved,
}: {
  kind: "expense" | "trip";
  record: Expense | Trip | null;
  clients: Client[];
  jobs: Job[];
  settings: Settings;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const createKey = useRef<string | null>(null);
  const [clientId, setClientId] = useState(record?.client_id || ""),
    [jobId, setJobId] = useState(record?.job_id || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [billable, setBillable] = useState((record as Expense)?.billable || false);
  const expense = record as Expense | null,
    trip = record as Trip | null;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget),
      v = (key: string) => String(fd.get(key) || "");
    setBusy(true);
    setError("");
    try {
      const common = {
        client_id: clientId || null,
        job_id: jobId || null,
        ...(record
          ? { version: record.version, change_reason: v("reason") }
          : {}),
      };
      const p =
        kind === "expense"
          ? {
              ...common,
              vendor: v("vendor"),
              spent_on: v("date"),
              amount_minor: parseDecimal(v("amount")),
              tax_minor: parseDecimal(v("tax")),
              category: v("category"),
              description: v("description"),
              payment_method: v("method"),
              billable,
              recovery_minor: billable ? parseDecimal(v("recovery")) : 0,
            }
          : {
              ...common,
              travelled_on: v("date"),
              purpose: v("purpose"),
              origin: v("origin"),
              destination: v("destination"),
              distance_milli_km: parseDecimal(v("km"), 3),
              duration_seconds: Math.round(Number(v("minutes")) * 60),
              mileage_rate_minor: parseDecimal(v("mileage_rate")),
              time_rate_minor: parseDecimal(v("time_rate")),
              rounding_minutes: Number(v("rounding")),
              billable_mileage: fd.get("billable_mileage") === "on",
              billable_time: fd.get("billable_time") === "on",
            };
      const path = kind === "expense" ? "expenses" : "trips";
      const r = await request<{ id: string }>(
        path + (record ? "/" + record.id : ""),
        record ? "PUT" : "POST",
        p,
        record ? undefined : (createKey.current ||= await requestKey()),
      );
      await onSaved(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`${record ? "Edit" : "New"} ${kind}`}
      onClose={onClose}
      drawer
    >
      <form onSubmit={save}>
        <p className="muted">
          {kind === "expense"
            ? "Record vendor cost including tax. Customer recovery is a separate amount. CAD only."
            : "Manual mileage and travel time. Rates are your agreed customer rates; no tax deduction or CRA rate is assumed."}
        </p>
        <Field label={kind === "expense" ? "Expense date" : "Trip date"}>
          <input
            name="date"
            type="date"
            required
            defaultValue={
              kind === "expense"
                ? expense?.spent_on || todayIn(settings.timezone)
                : trip?.travelled_on || todayIn(settings.timezone)
            }
          />
        </Field>
        {kind === "expense" ? (
          <>
            <Field label="Expense vendor">
              <input
                name="vendor"
                required
                maxLength={160}
                defaultValue={expense?.vendor}
              />
            </Field>
            <div className="form-grid">
              <Field label="Expense total including tax (CAD)">
                <input
                  name="amount"
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={cash(expense?.amount_minor)}
                />
              </Field>
              <Field label="Tax included in expense (CAD)">
                <input
                  name="tax"
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={cash(expense?.tax_minor)}
                />
              </Field>
              <Field label="Expense category">
                <input
                  name="category"
                  required
                  maxLength={80}
                  defaultValue={expense?.category || "Supplies"}
                  list="expense-categories"
                />
              </Field>
              <Field label="Expense payment method">
                <select
                  name="method"
                  defaultValue={expense?.payment_method || "other"}
                >
                  {[
                    "e_transfer",
                    "cash",
                    "cheque",
                    "credit_card",
                    "debit",
                    "other",
                  ].map((m) => (
                    <option key={m} value={m}>
                      {m.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <datalist id="expense-categories">
              {[
                "Supplies",
                "Software",
                "Office",
                "Travel",
                "Equipment",
                "Other",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </datalist>
            <Field label="Expense description">
              <textarea
                name="description"
                maxLength={4000}
                defaultValue={expense?.description}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Trip purpose">
              <input
                name="purpose"
                required
                maxLength={500}
                defaultValue={trip?.purpose}
              />
            </Field>
            <div className="form-grid">
              <Field label="Trip origin (optional)">
                <input
                  name="origin"
                  maxLength={300}
                  defaultValue={trip?.origin}
                />
              </Field>
              <Field label="Trip destination (optional)">
                <input
                  name="destination"
                  maxLength={300}
                  defaultValue={trip?.destination}
                />
              </Field>
              <Field label="Distance (km)">
                <input
                  name="km"
                  required
                  type="number"
                  min="0"
                  max="100000"
                  step="0.001"
                  defaultValue={String((trip?.distance_milli_km || 0) / 1000)}
                />
              </Field>
              <Field label="Travel duration (minutes)">
                <input
                  name="minutes"
                  required
                  type="number"
                  min="0"
                  max="525600"
                  step="0.05"
                  defaultValue={String((trip?.duration_seconds || 0) / 60)}
                />
              </Field>
              <Field label="Customer mileage rate (CAD/km)">
                <input
                  name="mileage_rate"
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={cash(trip?.mileage_rate_minor)}
                />
              </Field>
              <Field label="Customer travel labour rate (CAD/hour)">
                <input
                  name="time_rate"
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={cash(
                    trip?.time_rate_minor ?? settings.hourly_rate_minor,
                  )}
                />
              </Field>
              <Field label="Travel time rounding (minutes)">
                <select
                  name="rounding"
                  defaultValue={
                    trip?.rounding_minutes || settings.rounding_minutes
                  }
                >
                  {[1, 5, 6, 10, 15, 30, 60].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        )}
        <h3>Association & customer billing</h3>
        <Field label="Cost client (optional)">
          <select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setJobId("");
            }}
          >
            <option value="">Business only / no client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cost job (optional)">
          <select
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            disabled={!clientId}
          >
            <option value="">No job</option>
            {jobs
              .filter((j) => j.client_id === clientId)
              .map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
          </select>
        </Field>
        {kind === "expense" ? (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={billable}
                onChange={(e) => setBillable(e.target.checked)}
              />
              Create a separate billable recovery charge
            </label>
            {billable && (
              <Field label="Customer recovery amount before invoice tax (CAD)">
                <input
                  name="recovery"
                  required
                  type="number"
                  min="0"
                  max="10000000"
                  step="0.01"
                  defaultValue={cash(expense?.recovery_minor)}
                />
              </Field>
            )}
          </>
        ) : (
          <>
            <label className="check">
              <input
                type="checkbox"
                name="billable_mileage"
                defaultChecked={trip?.billable_mileage}
              />
              Create a billable mileage charge
            </label>
            <label className="check">
              <input
                type="checkbox"
                name="billable_time"
                defaultChecked={trip?.billable_time}
              />
              Create a separate billable travel labour charge
            </label>
          </>
        )}
        {record && (
          <Field label="Cost correction reason">
            <textarea name="reason" required maxLength={1000} />
          </Field>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button className="primary" disabled={busy}>
            {kind === "expense" ? "Save expense" : "Save trip"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export default function ExpensesPanel({
  clients,
  settings,
  recordId,
  onNavigate,
  notify,
}: Props) {
  const [expenses, setExpenses] = useState<Expense[]>([]),
    [trips, setTrips] = useState<Trip[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [detail, setDetail] = useState<CostDetail | null>(null),
    [tab, setTab] = useState(
      recordId === "charges"
        ? "charges"
        : recordId.startsWith("trip:")
          ? "trips"
          : "expenses",
    ),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(0),
    [editing, setEditing] = useState<{
      kind: "expense" | "trip";
      record: Expense | Trip | null;
    } | null>(null),
    [error, setError] = useState("");
  const isTrip = recordId.startsWith("trip:"),
    detailId =
      recordId && !["new", "new-trip", "charges"].includes(recordId)
        ? isTrip
          ? recordId.slice(5)
          : recordId
        : "";
  const load = useCallback(async () => {
    const [e, t, j] = await Promise.all([
      request<Expense[]>("expenses"),
      request<Trip[]>("trips"),
      request<Job[]>("jobs"),
    ]);
    setExpenses(e);
    setTrips(t);
    setJobs(j);
    if (detailId)
      setDetail(
        await request<CostDetail>((isTrip ? "trips/" : "expenses/") + detailId),
      );
    if (recordId === "new" || recordId === "new-trip")
      setEditing({
        kind: recordId === "new" ? "expense" : "trip",
        record: null,
      });
  }, [detailId, isTrip, recordId]);
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, [load]);
  function close() {
    setEditing(null);
    if (["new", "new-trip"].includes(recordId)) onNavigate("expenses");
  }
  async function archive() {
    if (!detail) return;
    const reason = prompt(
      "Why archive this cost record? Its history and receipts are retained.",
    );
    if (!reason?.trim()) return;
    try {
      await request((isTrip ? "trips/" : "expenses/") + detail.id, "DELETE", {
        version: detail.version,
        reason,
      });
      notify("Cost archived; unallocated charges removed from the queue.");
      onNavigate("expenses");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const visible = (tab === "trips" ? trips : expenses).filter(
    (c) =>
      (filter === "all" || c.client_id === filter) &&
      JSON.stringify([
        "vendor" in c ? c.vendor : c.purpose,
        "description" in c ? c.description : "",
        c.client_name,
      ])
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">COSTS & TRAVEL</p>
          <h1>
            {detail ? (isTrip ? "Trip detail" : "Expense detail") : "Expenses"}
          </h1>
          <p>
            Keep actual business costs separate from charges billed to clients.
          </p>
        </div>
        <div className="actions">
          <button
            className="primary"
            onClick={() => onNavigate("expenses", "new")}
          >
            + New expense
          </button>
          <button onClick={() => onNavigate("expenses", "new-trip")}>
            + New trip
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="alert danger">
          {error}
        </p>
      )}
      {detailId ? (
        detail ? (
          <>
            <button className="link" onClick={() => onNavigate("expenses")}>
              ← Expenses & trips
            </button>
            <section className="card">
              <div className="section-heading">
                <h2>{"vendor" in detail ? detail.vendor : detail.purpose}</h2>
                <Tag>{detail.allocated ? "allocated" : "unallocated"}</Tag>
              </div>
              {"vendor" in detail ? (
                <>
                  <p>
                    {detail.spent_on} · {detail.category} ·{" "}
                    {detail.payment_method.replaceAll("_", " ")}
                  </p>
                  <dl className="invoice-summary">
                    <div>
                      <dt>Vendor cost including tax</dt>
                      <dd>{money(detail.amount_minor)}</dd>
                    </div>
                    <div>
                      <dt>Included tax component</dt>
                      <dd>{money(detail.tax_minor)}</dd>
                    </div>
                    <div>
                      <dt>Separate customer recovery</dt>
                      <dd>{money(detail.recovery_minor)}</dd>
                    </div>
                  </dl>
                  <p className="preserve">{detail.description}</p>
                </>
              ) : (
                <>
                  <p>
                    {detail.travelled_on} · {detail.distance_milli_km / 1000} km
                    · {duration(detail.duration_seconds)}
                  </p>
                  <p>
                    {detail.origin}{" "}
                    {detail.destination ? "→ " + detail.destination : ""}
                  </p>
                  <p>
                    Mileage {money(detail.mileage_rate_minor)}/km · travel
                    labour {money(detail.time_rate_minor)}/hour · rounds up{" "}
                    {detail.rounding_minutes} minutes.
                  </p>
                </>
              )}
              {detail.client_id && (
                <button
                  className="link"
                  onClick={() => onNavigate("clients", detail.client_id!)}
                >
                  {detail.client_name || "Client"}
                </button>
              )}
              {detail.job_id && (
                <button
                  className="link"
                  onClick={() => onNavigate("jobs", detail.job_id!)}
                >
                  Open linked job
                </button>
              )}
              <div className="actions">
                <button
                  disabled={detail.allocated}
                  onClick={() =>
                    setEditing({
                      kind: isTrip ? "trip" : "expense",
                      record: detail,
                    })
                  }
                >
                  Edit {isTrip ? "trip" : "expense"}
                </button>
                <button
                  className="danger"
                  disabled={detail.allocated}
                  onClick={() => void archive()}
                >
                  Archive {isTrip ? "trip" : "expense"}
                </button>
                <button onClick={() => onNavigate("expenses", "charges")}>
                  View unbilled charges
                </button>
              </div>
              {detail.allocated && (
                <p className="notice">
                  This cost is allocated. Its recorded facts are locked; remove
                  the charge from its draft or use an explicit invoice
                  correction.
                </p>
              )}
              {detail.charges.map((c) => (
                <p key={c.id}>
                  {c.kind.replaceAll("_", " ")}:{" "}
                  <strong>{money(c.amount_minor)}</strong>
                </p>
              ))}
            </section>
            {detail.revisions?.length ? (
              <section className="card">
                <h2>Cost correction history</h2>
                {detail.revisions.map((r) => (
                  <div className="history-event" key={r.id}>
                    <p>{r.reason}</p>
                    <small>
                      {new Date(r.created_at).toLocaleString("en-CA", {
                        timeZone: settings.timezone,
                      })}
                    </small>
                  </div>
                ))}
              </section>
            ) : null}
            {!isTrip && (
              <>
                <JobFiles
                  jobId={detail.id}
                  context="expenses"
                  notify={notify}
                />
                <section className="card">
                  <h2>Expense notes</h2>
                  {detail.notes?.map((n) => (
                    <div className="markdown" key={n.id}>
                      <Markdown skipHtml>{n.body}</Markdown>
                    </div>
                  ))}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget,
                        body = String(new FormData(form).get("body") || "");
                      void request("notes", "POST", {
                        client_id: null,
                        activity_id: null,
                        job_id: null,
                        expense_id: detail.id,
                        body,
                      })
                        .then(async () => {
                          form.reset();
                          await load();
                          notify("Expense note saved.");
                        })
                        .catch((e) => setError(e.message));
                    }}
                  >
                    <Field label="New expense note">
                      <textarea name="body" required maxLength={20000} />
                    </Field>
                    <button>Add expense note</button>
                  </form>
                </section>
              </>
            )}
          </>
        ) : (
          <p role="status">Loading cost record…</p>
        )
      ) : (
        <>
          <div className="tabs" aria-label="Expense sections">
            {[
              ["expenses", "Expenses"],
              ["trips", "Trips"],
              ["charges", "Unbilled charges"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                aria-pressed={tab === key}
                onClick={() => {
                  setTab(key);
                  setPage(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "charges" ? (
            <ChargesQueue
              clients={clients}
              onNavigate={onNavigate}
              notify={notify}
            />
          ) : (
            <section className="card">
              <div className="filters">
                <Field label="Search costs">
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(0);
                    }}
                  />
                </Field>
                <Field label="Cost client filter">
                  <select
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="all">All associations</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {tab === "expenses" && (
                <p>
                  Total recorded cost for this filter, including tax:{" "}
                  <strong>
                    {money(
                      (visible as Expense[])
                        .reduce((n, c) => n + BigInt(c.amount_minor), 0n)
                        .toString(),
                    )}
                  </strong>
                  . Customer recoveries are separate invoice revenue.
                </p>
              )}
              {visible.length ? (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>
                            {tab === "expenses"
                              ? "Vendor / description"
                              : "Trip purpose"}
                          </th>
                          <th>Date</th>
                          <th>Client</th>
                          <th>
                            {tab === "expenses"
                              ? "Cost CAD"
                              : "Distance / time"}
                          </th>
                          <th>Billing</th>
                          <th>Open</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.slice(page * 20, page * 20 + 20).map((c) => (
                          <tr key={c.id}>
                            <td>{"vendor" in c ? c.vendor : c.purpose}</td>
                            <td>
                              {"spent_on" in c ? c.spent_on : c.travelled_on}
                            </td>
                            <td>{c.client_name || "Business only"}</td>
                            <td>
                              {"amount_minor" in c
                                ? money(c.amount_minor)
                                : `${c.distance_milli_km / 1000} km · ${duration(c.duration_seconds)}`}
                            </td>
                            <td>
                              <Tag>
                                {c.allocated
                                  ? "allocated"
                                  : (
                                        "billable" in c
                                          ? c.billable
                                          : c.billable_mileage ||
                                            c.billable_time
                                      )
                                    ? "billable"
                                    : "business only"}
                              </Tag>
                            </td>
                            <td>
                              <button
                                onClick={() =>
                                  onNavigate(
                                    "expenses",
                                    (tab === "trips" ? "trip:" : "") + c.id,
                                  )
                                }
                              >
                                Open {tab === "trips" ? "trip" : "expense"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pagination">
                    <button
                      disabled={!page}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous cost page
                    </button>
                    <span>
                      Page {page + 1} of {Math.ceil(visible.length / 20)}
                    </span>
                    <button
                      disabled={(page + 1) * 20 >= visible.length}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next cost page
                    </button>
                  </div>
                </>
              ) : (
                <Empty title="No matching costs">
                  <p>
                    Add a fictional expense or trip, or adjust your filters.
                  </p>
                </Empty>
              )}
            </section>
          )}
        </>
      )}
      {editing && (
        <CostForm
          key={editing.record?.id || editing.kind}
          kind={editing.kind}
          record={editing.record}
          clients={clients}
          jobs={jobs}
          settings={settings}
          onClose={close}
          onSaved={async (id) => {
            setEditing(null);
            notify(
              editing.kind === "expense"
                ? "Expense saved; cost and recovery remain separate."
                : "Trip saved with mileage and travel-rate snapshots.",
            );
            await load();
            onNavigate(
              "expenses",
              (editing.kind === "trip" ? "trip:" : "") + id,
            );
          }}
        />
      )}
    </>
  );
}
