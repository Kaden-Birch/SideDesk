"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Markdown from "react-markdown";
import JobFiles from "./JobFiles";
import {
  request,
  requestKey,
  duration,
  type Client,
  type Activity,
  type Note,
} from "@/lib/client";
import { Field, Tag, Empty } from "@/components/ui";
import { parseDecimal, money } from "@/features/billing/money";
import type { Job } from "@/features/billing/model";
type Detail = Job & {
  activities: Activity[];
  notes: Note[];
  entries: {
    id: string;
    duration_seconds: number;
    rate_minor: string;
    invoice_number: string;
  }[];
  invoices: { id: string; number: string | null; state: string }[];
};
export default function JobsPanel({
  clients,
  recordId,
  onNavigate,
  onActivity,
  notify,
}: {
  clients: Client[];
  recordId: string;
  onNavigate: (v: string, id?: string) => void;
  onActivity: (j: Job) => void;
  notify: (s: string) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]),
    [job, setJob] = useState<Detail | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all");
  const load = useCallback(async () => {
    if (recordId && recordId !== "new")
      setJob(await request<Detail>("jobs/" + recordId));
    else setJobs(await request<Job[]>("jobs"));
  }, [recordId]);
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, [load]);
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
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget),
      get = (k: string) => String(fd.get(k) || "");
    await run(async () => {
      const body = {
        client_id: job?.client_id || get("client_id"),
        title: get("title"),
        description: get("description"),
        status: get("status"),
        priority: get("priority"),
        due_date: get("due_date") || null,
        hourly_rate_minor: get("rate") ? parseDecimal(get("rate")) : null,
        ...(job ? { version: job.version } : {}),
      };
      const result = await request<{ id: string }>(
        "jobs" + (job ? "/" + job.id : ""),
        job ? "PUT" : "POST",
        body,
        job ? undefined : await requestKey(),
      );
      notify("Job saved. Completing it never issues an invoice automatically.");
      if (!job) onNavigate("jobs", result.id);
      else await load();
    });
  }
  if (!recordId)
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">STRUCTURED WORK</p>
            <h1>Jobs</h1>
            <p>Keep scope, deadlines and related activities together.</p>
          </div>
          <button
            className="primary"
            disabled={!clients.length}
            onClick={() => onNavigate("jobs", "new")}
          >
            + New job
          </button>
        </div>
        <div className="toolbar">
          <button onClick={() => onNavigate("work")}>Activities</button>
          <Tag>Jobs</Tag>
          <button onClick={() => onNavigate("sales", "unbilled")}>
            Unbilled work
          </button>
        </div>
        {error && (
          <p className="alert danger" role="alert">
            {error}
          </p>
        )}
        <div className="toolbar">
          <input
            aria-label="Search jobs"
            placeholder="Search jobs or client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Filter job status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            {[
              "draft",
              "open",
              "in_progress",
              "waiting",
              "completed",
              "cancelled",
            ].map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        {jobs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th>Unbilled time</th>
                </tr>
              </thead>
              <tbody>
                {jobs
                  .filter(
                    (j) =>
                      (status === "all" || j.status === status) &&
                      (j.title + " " + j.client_name)
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map((j) => (
                    <tr key={j.id}>
                      <td>
                        <button
                          className="link"
                          onClick={() => {
                            setJob(null);
                            onNavigate("jobs", j.id);
                          }}
                        >
                          {j.title}
                        </button>
                      </td>
                      <td>{j.client_name}</td>
                      <td>
                        <Tag>{j.status.replaceAll("_", " ")}</Tag>
                      </td>
                      <td>{j.due_date || "—"}</td>
                      <td>{duration(j.unbilled_seconds)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No jobs yet">
            Quick activities still work without a job. Create one when a piece
            of work needs more structure.
          </Empty>
        )}
      </>
    );
  if (recordId !== "new" && !job)
    return <p role="status">Loading job… {error}</p>;
  return (
    <>
      <button
        className="link back"
        onClick={() => {
          setJob(null);
          onNavigate("jobs");
        }}
      >
        ← All jobs
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SCOPE & DELIVERY</p>
          <h1>{job?.title || "New job"}</h1>
          {job && (
            <button
              className="link"
              onClick={() => onNavigate("clients", job.client_id)}
            >
              {job.client_name}
            </button>
          )}
        </div>
        {job && (
          <div className="actions">
            <button className="primary" onClick={() => onActivity(job)}>
              + Log activity for job
            </button>
            <button onClick={() => onNavigate("sales", "unbilled")}>
              Review unbilled work
            </button>
          </div>
        )}
      </div>
      {error && (
        <p className="alert danger" role="alert">
          {error}
        </p>
      )}
      <div className="dashboard-grid">
        <section className="card">
          <h2>Job details</h2>
          <form className="stack" key={job?.version || "new"} onSubmit={save}>
            {!job && (
              <Field label="Client">
                <select name="client_id" required>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Job title">
              <input
                name="title"
                defaultValue={job?.title}
                maxLength={200}
                required
              />
            </Field>
            <Field label="Description / scope">
              <textarea
                name="description"
                defaultValue={job?.description}
                rows={6}
                maxLength={20000}
              />
            </Field>
            <div className="form-grid">
              <Field label="Job status">
                <select name="status" defaultValue={job?.status || "open"}>
                  {[
                    "draft",
                    "open",
                    "in_progress",
                    "waiting",
                    "completed",
                    "cancelled",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  name="priority"
                  defaultValue={job?.priority || "normal"}
                >
                  {["low", "normal", "high", "urgent"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Due date">
                <input
                  name="due_date"
                  type="date"
                  defaultValue={job?.due_date || ""}
                />
              </Field>
              <Field
                label="Job hourly rate override (CAD)"
                hint="Blank uses the client, then business default. New time entries snapshot this rate."
              >
                <input
                  name="rate"
                  type="number"
                  min="0"
                  step="0.01"
                  max="1000000"
                  defaultValue={
                    job?.hourly_rate_minor == null
                      ? ""
                      : Number(job.hourly_rate_minor) / 100
                  }
                />
              </Field>
            </div>
            <button className="primary" disabled={busy || !clients.length}>
              {busy ? "Saving…" : "Save job"}
            </button>
          </form>
        </section>
        {job && (
          <div className="stack">
            <section className="card">
              <h2>Linked activities</h2>
              {job.activities.length ? (
                job.activities.map((a) => (
                  <div className="row record-row" key={a.id}>
                    <button
                      className="link"
                      onClick={() => onNavigate("work", a.id)}
                    >
                      {a.title}
                    </button>
                    <Tag>{a.status}</Tag>
                    <span>{duration(a.duration_seconds)}</span>
                  </div>
                ))
              ) : (
                <p className="muted">
                  No activities assigned. Add one here, or attach existing
                  client work from its activity page.
                </p>
              )}
              <h3>Time history</h3>
              {job.entries.map((e) => (
                <p key={e.id}>
                  {duration(e.duration_seconds)} · {money(e.rate_minor)}/h ·{" "}
                  {e.invoice_number || "Not issued"}
                </p>
              ))}
              <small>
                Historical time keeps its original job and billing policy when
                activities are moved.
              </small>
              <h3>Invoices</h3>
              {job.invoices.map((i) => (
                <p key={i.id}>
                  <button
                    className="link"
                    onClick={() => onNavigate("sales", i.id)}
                  >
                    {i.number || "Draft invoice"} · {i.state}
                  </button>
                </p>
              ))}
            </section>
            <JobFiles jobId={job.id} notify={notify} />
            <section className="card">
              <h2>Job notes</h2>
              {job.notes.map((n) => (
                <article className="note-body" key={n.id}>
                  <Markdown skipHtml>{n.body}</Markdown>
                </article>
              ))}
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    body = String(new FormData(form).get("body") || "");
                  void run(async () => {
                    await request("notes", "POST", {
                      client_id: null,
                      activity_id: null,
                      job_id: job.id,
                      body,
                    });
                    form.reset();
                    await load();
                    notify("Job note saved.");
                  });
                }}
              >
                <Field label="Add job note">
                  <textarea name="body" maxLength={20000} required />
                </Field>
                <button disabled={busy}>Save note</button>
              </form>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
