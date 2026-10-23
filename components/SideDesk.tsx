"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Markdown from "react-markdown";
import {
  request,
  requestKey,
  setCsrf,
  duration,
  type Client,
  type Activity,
  type Timer,
  type Contact,
  type Note,
  type CredentialMeta,
  type Settings,
} from "@/lib/client";
import { Dialog, Empty, Field, Tag } from "./ui";
import SalesPanel, {
  TimeReviewDialog,
  ClientBillingLinks,
  BillingOverview,
} from "@/features/billing/SalesPanel";
import JobsPanel from "@/features/jobs/JobsPanel";
import BusinessProfile from "@/features/billing/BusinessProfile";
import { parseDecimal } from "@/features/billing/money";
import type { Job } from "@/features/billing/model";
const VaultPanel = dynamic(() => import("./VaultPanel"), {
  ssr: false,
  loading: () => <p role="status">Loading vault…</p>,
});
type State = {
  initialized: boolean;
  authenticated: boolean;
  csrf: string;
  settings: Settings;
  vault_initialized: boolean;
};
type Detail = Client & {
  contacts: Contact[];
  notes: Note[];
  activities: Activity[];
  credentials: CredentialMeta[];
};
type ActivityDetail = Omit<Activity, "notes"> & {
  activity_notes: string;
  notes: Note[];
  entries: {
    id: string;
    duration_seconds: number;
    source: string;
    billable: boolean;
    rate_minor: string;
    rounding_minutes: number;
    rounding_scope: string;
    allocated: boolean;
    version: number;
    created_at: string;
  }[];
};
const recommendation =
  "HTTPS is strongly recommended for an application storing client credentials. Without HTTPS, certain browser security features (including browser-based encryption and clipboard access) may not work. SideDesk will never disable encryption to compensate.";
const err = (e: unknown) =>
  e instanceof Error ? e.message : "Operation failed";
const number = (fd: FormData, key: string) => Number(fd.get(key) || 0);
const value = (fd: FormData, key: string) => String(fd.get(key) || "");
export default function SideDesk() {
  const [state, setState] = useState<State | null>(null),
    [clients, setClients] = useState<Client[]>([]),
    [activities, setActivities] = useState<Activity[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [suggestedJob, setSuggestedJob] = useState<Job | null>(null),
    [draftClient, setDraftClient] = useState(""),
    [reviewTime, setReviewTime] = useState<
      ActivityDetail["entries"][number] | null
    >(null),
    [timer, setTimer] = useState<Timer | null>(null),
    [offset, setOffset] = useState(0),
    [now, setNow] = useState(() => Date.now()),
    [view, setView] = useState("dashboard"),
    [recordId, setRecordId] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [activityDetail, setActivityDetail] = useState<ActivityDetail | null>(null);
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<
      | "client"
      | "activity"
      | "contact"
      | "note"
      | "time"
      | "search"
      | "password"
      | null
    >(null),
    [editClient, setEditClient] = useState<Client | null>(null),
    [filter, setFilter] = useState(""),
    [sort, setSort] = useState("name"),
    [page, setPage] = useState(0),
    [search, setSearch] = useState(""),
    [theme, setTheme] = useState("system"),
    [mobile, setMobile] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [lockSignal, setLockSignal] = useState(0),
    [vaultUnlocked, setVaultUnlocked] = useState(false),
    [setupWarningDismissed, setSetupWarningDismissed] = useState(false),
    [diagnostics, setDiagnostics] = useState<Record<string, boolean> | null>(
      null,
    );
  const notify = useCallback((s: string) => setToast(s), []);
  const handleVaultState = useCallback((unlocked: boolean) => {
    setVaultUnlocked(unlocked);
    if (unlocked) setState((s) => (s ? { ...s, vault_initialized: true } : s));
  }, []);
  const navigate = useCallback((v: string, id = "") => {
    setView(v);
    setRecordId(id);
    setDetail(null);
    setActivityDetail(null);
    setError("");
    setFilter("");
    setPage(0);
    setMobile(false);
    window.history.pushState({}, "", `/?view=${v}${id ? "&id=" + id : ""}`);
  }, []);
  const refresh = useCallback(async () => {
    const s = await request<State>("state");
    setCsrf(s.csrf);
    setState(s);
    if (s.authenticated) {
      const [c, a, t, j] = await Promise.all([
        request<Client[]>("clients"),
        request<Activity[]>("activities"),
        request<{ timer: Timer | null; server_now: string }>("timer"),
        request<Job[]>("jobs"),
      ]);
      setJobs(j);
      setClients(c);
      setActivities(a);
      setTimer(t.timer);
      setOffset(new Date(t.server_now).getTime() - Date.now());
    }
  }, []);
  const reloadDetail = useCallback(async () => {
    if (!recordId) return;
    if (view === "clients")
      setDetail(await request<Detail>("clients/" + recordId));
    if (view === "work")
      setActivityDetail(
        await request<ActivityDetail>("activities/" + recordId),
      );
  }, [recordId, view]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  const lockAll = useCallback(() => {
    setLockSignal((v) => v + 1);
    const c = new BroadcastChannel("sidedesk-vault-lock");
    c.postMessage("lock");
    c.close();
  }, []);
  useEffect(() => {
    const restore = () => {
      const q = new URLSearchParams(location.search);
      const v = q.get("view") || "dashboard";
      setView(
        [
          "dashboard",
          "clients",
          "work",
          "jobs",
          "sales",
          "credentials",
          "settings",
        ].includes(v)
          ? v
          : "dashboard",
      );
      setRecordId(q.get("id") || "");
    };
    void Promise.resolve().then(restore);
    void Promise.resolve()
      .then(refresh)
      .catch((e) => setError(err(e)));
    window.addEventListener("popstate", restore);
    const expired = () => {
      lockAll();
      setState((s) => (s ? { ...s, authenticated: false } : s));
      setClients([]);
      setActivities([]);
      setJobs([]);
      setReviewTime(null);
      setDetail(null);
      setActivityDetail(null);
      setTimer(null);
      setModal(null);
      setError("Your session expired. Sign in again.");
      void request<State>("state")
        .then((s) => {
          setCsrf(s.csrf);
          setState(s);
        })
        .catch(() => {});
    };
    window.addEventListener("sidedesk-expired", expired);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("sidedesk-expired", expired);
    };
  }, [refresh, lockAll]);
  useEffect(() => {
    if (state?.authenticated)
      void Promise.resolve()
        .then(reloadDetail)
        .catch((e) => setError(err(e)));
  }, [state?.authenticated, reloadDetail]);
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!state?.authenticated) return;
    const id = setInterval(() => {
      void request<{ timer: Timer | null; server_now: string }>("timer")
        .then((t) => {
          setTimer(t.timer);
          setOffset(new Date(t.server_now).getTime() - Date.now());
        })
        .catch((e) => setError(err(e)));
    }, 15000);
    return () => clearInterval(id);
  }, [state?.authenticated]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const stored = localStorage.getItem("sidedesk-theme") || "system";
    queueMicrotask(() => setTheme(stored));
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const selected = localStorage.getItem("sidedesk-theme") || "system";
      document.documentElement.dataset.theme =
        selected === "system" ? (media.matches ? "dark" : "light") : selected;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k" && state?.authenticated) {
        e.preventDefault();
        setModal("search");
        setSearch("");
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [state?.authenticated]);
  function changeTheme(v: string) {
    setTheme(v);
    localStorage.setItem("sidedesk-theme", v);
    document.documentElement.dataset.theme =
      v === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : v;
  }
  async function auth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await run(async () => {
      const body = {
        login_name: value(fd, "login_name"),
        password: value(fd, "password"),
        ...(!state?.initialized
          ? {
              setup_token: value(fd, "setup_token"),
              name: value(fd, "name"),
              timezone: value(fd, "timezone"),
              hourly_rate_minor: parseDecimal(value(fd, "hourly_rate")),
            }
          : {}),
      };
      await request(state?.initialized ? "login" : "setup", "POST", body);
      e.currentTarget?.reset();
      await refresh();
      navigate("dashboard");
      notify(
        state?.initialized
          ? "Signed in. Vault remains locked."
          : "Workspace created. Complete your storage check in Settings.",
      );
    });
  }
  async function logout() {
    lockAll();
    await run(async () => {
      await request("logout", "POST", {});
      setClients([]);
      setActivities([]);
      setDetail(null);
      setActivityDetail(null);
      setModal(null);
      await refresh();
    });
  }
  async function timerAction(
    action: "start" | "pause" | "resume" | "stop",
    activity_id?: string,
    rateOverride?: number | null,
  ) {
    await run(async () => {
      const changed = await request<{ accumulated_seconds: number }>(
        "timer",
        "POST",
        {
          action,
          ...(action === "start"
            ? { activity_id, rate_minor: rateOverride ?? null }
            : { timer_id: timer?.id, version: timer?.version }),
        },
        await requestKey(),
      );
      await refresh();
      await reloadDetail();
      notify(
        action === "stop"
          ? changed.accumulated_seconds > 0
            ? "Timer stopped. Completed time saved."
            : "Timer stopped before one second elapsed; no time entry created."
          : "Timer updated.",
      );
    });
  }
  async function saveForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await run(async () => {
      if (modal === "client") {
        const body = {
          name: value(fd, "name"),
          type: value(fd, "type"),
          email: value(fd, "email"),
          phone: value(fd, "phone"),
          billing_address: value(fd, "billing_address"),
          hourly_rate_minor: value(fd, "rate")
            ? parseDecimal(value(fd, "rate"))
            : null,
          ...(editClient ? { version: editClient.version } : {}),
        };
        const c = await request<Client>(
          "clients" + (editClient ? "/" + editClient.id : ""),
          editClient ? "PUT" : "POST",
          body,
        );
        setModal(null);
        await refresh();
        navigate("clients", c.id);
        notify("Client saved.");
      } else if (modal === "activity") {
        const a = await request<Activity>(
          "activities",
          "POST",
          {
            client_id: value(fd, "client_id"),
            job_id: value(fd, "job_id") || null,
            rate_minor: value(fd, "rate_override")
              ? parseDecimal(value(fd, "rate_override"))
              : null,
            title: value(fd, "title"),
            billable: fd.has("billable"),
            notes: value(fd, "notes"),
            duration_seconds: Math.round(number(fd, "minutes") * 60),
          },
          await requestKey(),
        );
        setModal(null);
        await refresh();
        navigate("work", a.id);
        notify("Activity saved.");
        if (fd.has("start_timer"))
          await timerAction(
            "start",
            a.id,
            value(fd, "rate_override")
              ? parseDecimal(value(fd, "rate_override"))
              : null,
          );
      } else if (modal === "contact") {
        await request("contacts", "POST", {
          client_id: recordId,
          name: value(fd, "name"),
          email: value(fd, "email"),
          phone: value(fd, "phone"),
          role: value(fd, "role"),
        });
        setModal(null);
        await reloadDetail();
        notify("Contact added.");
      } else if (modal === "note") {
        await request("notes", "POST", {
          client_id: view === "clients" ? recordId : null,
          activity_id: view === "work" ? recordId : null,
          body: value(fd, "body"),
        });
        setModal(null);
        await reloadDetail();
        notify("Note saved.");
      } else if (modal === "time") {
        await request(
          "time-entries",
          "POST",
          {
            activity_id: recordId,
            rate_minor: value(fd, "rate_override")
              ? parseDecimal(value(fd, "rate_override"))
              : null,
            duration_seconds: Math.round(number(fd, "minutes") * 60),
          },
          await requestKey(),
        );
        setModal(null);
        await refresh();
        await reloadDetail();
        notify("Manual time saved.");
      } else if (modal === "password") {
        await request("password", "PUT", {
          current: value(fd, "current"),
          password: value(fd, "password"),
        });
        lockAll();
        setModal(null);
        await refresh();
        notify(
          "Login password changed. All sessions revoked; vault password is unchanged.",
        );
      }
    });
  }
  async function saveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await run(async () => {
      await request("settings", "PUT", {
        name: value(fd, "name"),
        timezone: value(fd, "timezone"),
        hourly_rate_minor: parseDecimal(value(fd, "rate")),
        rounding_minutes: number(fd, "rounding"),
        invoice_prefix: value(fd, "prefix"),
        tax_enabled: fd.has("tax_enabled"),
        vault_idle_minutes: number(fd, "idle"),
        https_dismissed: state!.settings.https_dismissed,
        version: state!.settings.version,
      });
      await refresh();
      notify("Settings saved.");
    });
  }
  async function dismissHttps() {
    await run(async () => {
      const s = state!.settings;
      await request("settings", "PUT", {
        ...selectSettings(s),
        https_dismissed: true,
      });
      await refresh();
    });
  }
  if (!state)
    return (
      <div className="startup">
        <h1>SideDesk</h1>
        <p role="status">Connecting to your workspace…</p>
        {error && (
          <p role="alert" className="alert danger">
            {error}
          </p>
        )}
      </div>
    );
  if (!state.authenticated)
    return (
      <main className="auth-layout">
        <section className="auth-intro">
          <div className="brand">
            <span className="brand-icon">S</span>SideDesk
          </div>
          <p className="eyebrow">YOUR INDEPENDENT WORKSPACE</p>
          <h1>
            A clear desk.
            <br />A connected business.
          </h1>
          <p>
            Clients, everyday work and encrypted credentials, in one private
            place.
          </p>
          <div className="intro-foot">
            Self-hosted · One owner · Your records
          </div>
        </section>
        <section className="auth-form">
          <div className="row">
            <Tag>{state.initialized ? "WELCOME BACK" : "FIRST-RUN SETUP"}</Tag>
            <Theme value={theme} onChange={changeTheme} />
          </div>
          <h2>
            {state.initialized
              ? "Sign in to SideDesk"
              : "Create your workspace"}
          </h2>
          <p className="muted">
            {state.initialized
              ? "Your vault will remain locked until you unlock it separately."
              : "SideDesk manages freelance work for one owner. Keep independent backups of your deployment."}
          </p>
          {error && (
            <p className="alert danger" role="alert">
              {error}
            </p>
          )}
          {!state.initialized && !setupWarningDismissed && (
            <div className="alert">
              <p>{recommendation}</p>
              <button
                type="button"
                onClick={() => setSetupWarningDismissed(true)}
              >
                Dismiss recommendation
              </button>
            </div>
          )}
          <form className="stack" onSubmit={auth}>
            <Field label="Login name">
              <input
                name="login_name"
                autoComplete="username"
                maxLength={80}
                required
              />
            </Field>
            <Field
              label="Login password"
              hint={
                !state.initialized
                  ? "At least 14 characters. This is separate from your vault password."
                  : undefined
              }
            >
              <input
                name="password"
                type="password"
                autoComplete={
                  state.initialized ? "current-password" : "new-password"
                }
                minLength={state.initialized ? 1 : 14}
                maxLength={256}
                required
              />
            </Field>
            {!state.initialized && (
              <>
                <Field
                  label="One-use setup token"
                  hint="From your deployment configuration. Setup closes after owner creation."
                >
                  <input
                    name="setup_token"
                    type="password"
                    autoComplete="off"
                    required
                  />
                </Field>
                <Field label="Business or personal name">
                  <input name="name" maxLength={160} required />
                </Field>
                <Field label="Timezone">
                  <input
                    name="timezone"
                    defaultValue="America/Edmonton"
                    required
                  />
                </Field>
                <Field label="Default hourly rate (CAD)">
                  <input
                    name="hourly_rate"
                    type="number"
                    min="0"
                    max="1000000"
                    step="0.01"
                    defaultValue="0"
                    required
                  />
                </Field>
                <p className="notice">
                  Vault setup is optional and deferred until after onboarding in
                  a supported secure browser context. SMTP is added in Milestone
                  3.
                </p>
              </>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "Working…"
                : state.initialized
                  ? "Sign in"
                  : "Create owner & workspace"}
            </button>
          </form>
        </section>
      </main>
    );
  const elapsed = timer
    ? timer.accumulated_seconds +
      (timer.state === "running" && timer.segment_started_at
        ? Math.max(
            0,
            Math.floor(
              (now + offset - new Date(timer.segment_started_at).getTime()) /
                1000,
            ),
          )
        : 0)
    : 0;
  const filtered = clients
    .filter((c) =>
      [c.name, c.email, c.phone]
        .join(" ")
        .toLowerCase()
        .includes(filter.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name),
    );
  const openClients = () => {
    setEditClient(null);
    setModal("client");
  };
  return (
    <div className={`workspace ${collapsed ? "collapsed" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside
        aria-label="Workspace navigation"
        className={mobile ? "sidebar open" : "sidebar"}
      >
        <div className="brand">
          <span className="brand-icon">S</span>
          <span className="brand-text">SideDesk</span>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {[
            ["dashboard", "◫", "Dashboard"],
            ["clients", "♧", "Clients"],
            ["work", "◷", "Work"],
            ["sales", "▤", "Sales"],
            ["credentials", "⌑", "Credentials"],
            ["settings", "⚙", "Settings"],
          ].map(([key, icon, label]) => (
            <button
              key={key}
              title={label}
              className={
                view === key || (key === "work" && view === "jobs")
                  ? "active"
                  : ""
              }
              onClick={() => navigate(key)}
              aria-current={
                view === key || (key === "work" && view === "jobs")
                  ? "page"
                  : undefined
              }
            >
              <span className="nav-icon" aria-hidden="true">
                {icon}
              </span>
              <span className="nav-text">{label}</span>
            </button>
          ))}
        </nav>
        <div className="roadmap">
          <p className="nav-label">COMING IN LATER MILESTONES</p>
          <span>Quotes · Inventory · Expenses · Reports</span>
        </div>
        <div className="sidebar-footer">
          <button
            className="quiet"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "»" : "« Collapse"}
          </button>
          <small className="brand-text">Private deployment · CAD</small>
        </div>
      </aside>
      {mobile && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-area">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobile(!mobile)}
          >
            ☰
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>
              {
                {
                  dashboard: "Overview",
                  clients: "Clients",
                  work: "Work",
                  jobs: "Work / Jobs",
                  sales: "Sales",
                  credentials: "Credentials",
                  settings: "Settings",
                }[view]
              }
            </strong>
          </div>
          <div className="top-actions">
            <button
              className="search-button"
              onClick={() => setModal("search")}
            >
              Search <kbd>⌘ K</kbd>
            </button>
            <details className="quick-menu">
              <summary>+ New</summary>
              <div>
                <button onClick={openClients}>Client</button>
                <button
                  disabled={!clients.length}
                  onClick={() => navigate("jobs", "new")}
                >
                  Job
                </button>
                <button
                  disabled={!clients.length}
                  onClick={() => navigate("sales", "new")}
                >
                  Invoice
                </button>
                <button
                  disabled={!clients.length}
                  onClick={() => {
                    setSuggestedJob(null);
                    setDraftClient("");
                    setModal("activity");
                  }}
                >
                  Activity
                </button>
              </div>
            </details>
            <button
              onClick={lockAll}
              title="Lock vault in all tabs"
              aria-label={
                vaultUnlocked
                  ? "Lock vault in all tabs"
                  : "Vault locked; lock all tabs"
              }
            >
              {vaultUnlocked ? "Lock vault" : "Vault locked"}
            </button>
            <Theme value={theme} onChange={changeTheme} />
            <button onClick={() => void logout()}>Sign out</button>
          </div>
        </header>
        {timer && (
          <div className="timer-bar">
            <div>
              <Tag>{timer.state === "running" ? "Running" : "Paused"}</Tag>
              <button
                className="link"
                onClick={() => navigate("work", timer.activity_id)}
              >
                {timer.client_name} · {timer.title}
              </button>
              <strong className="numeric">{duration(elapsed)}</strong>
            </div>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  void timerAction(
                    timer.state === "running" ? "pause" : "resume",
                  )
                }
              >
                {timer.state === "running" ? "Pause" : "Resume"}
              </button>
              <button disabled={busy} onClick={() => void timerAction("stop")}>
                Stop & save
              </button>
            </div>
          </div>
        )}
        <main id="main" tabIndex={-1}>
          {error && (
            <p className="alert danger" role="alert">
              {error}
            </p>
          )}
          {!state.settings.https_dismissed && (
            <div className="https-banner">
              <p>{recommendation}</p>
              <button onClick={() => void dismissHttps()}>Dismiss</button>
            </div>
          )}
          {view === "dashboard" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">YOUR WORK, CONNECTED</p>
                  <h1>Overview</h1>
                  <p>
                    {state.settings.name} <span className="separator">/</span> A
                    place for your next piece of work.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={!clients.length}
                  onClick={() => {
                    setSuggestedJob(null);
                    setDraftClient("");
                    setModal("activity");
                  }}
                >
                  + Log activity
                </button>
              </div>
              <BillingOverview onNavigate={navigate} />
              <div className="metrics">
                <div>
                  <span>Active clients</span>
                  <strong>{clients.length}</strong>
                  <small>People and businesses you support</small>
                </div>
                <div>
                  <span>Open activities</span>
                  <strong>
                    {activities.filter((a) => a.status === "open").length}
                  </strong>
                  <small>Quick work, no job required</small>
                </div>
                <div>
                  <span>Time recorded</span>
                  <strong>
                    {duration(
                      activities.reduce((s, a) => s + a.duration_seconds, 0),
                    )}
                  </strong>
                  <small>Stopped and manual entries</small>
                </div>
              </div>
              <div className="dashboard-grid">
                <section className="card">
                  <div className="section-heading">
                    <h2>Recent work</h2>
                    <button className="link" onClick={() => navigate("work")}>
                      View work →
                    </button>
                  </div>
                  {activities.length ? (
                    <ActivityTable
                      activities={activities.slice(0, 5)}
                      onOpen={(a) => navigate("work", a.id)}
                    />
                  ) : (
                    <Empty title="Your next activity starts here">
                      Add a client, then log a quick activity or start a timer.
                    </Empty>
                  )}
                  <div className="actions">
                    <button onClick={openClients}>+ Add client</button>
                    <button
                      disabled={!clients.length}
                      onClick={() => {
                        setSuggestedJob(null);
                        setDraftClient("");
                        setModal("activity");
                      }}
                    >
                      Log activity
                    </button>
                  </div>
                </section>
                <section className="card">
                  <p className="eyebrow">WORKSPACE HEALTH</p>
                  <h2>Finish your setup</h2>
                  <ul className="checklist">
                    <li>
                      <span>Owner account</span>
                      <Tag>Ready</Tag>
                    </li>
                    <li>
                      <span>Business identity</span>
                      <Tag>Ready</Tag>
                    </li>
                    <li>
                      <span>Credential vault</span>
                      <Tag>
                        {state.vault_initialized ? "Created" : "Not set up"}
                      </Tag>
                    </li>
                    <li>
                      <span>Storage & backup</span>
                      <button
                        className="link"
                        onClick={() => navigate("settings")}
                      >
                        Check settings
                      </button>
                    </li>
                  </ul>
                  <p className="muted">
                    Financial reporting, quotes and invoices arrive in later
                    milestones.
                  </p>
                  <button onClick={() => navigate("credentials")}>
                    {state.vault_initialized
                      ? "Open credentials"
                      : "Set up vault"}
                  </button>
                </section>
              </div>
            </>
          )}
          {view === "clients" && !recordId && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">RELATIONSHIPS</p>
                  <h1>Clients</h1>
                  <p>Contacts, work and credentials with the right context.</p>
                </div>
                <button className="primary" onClick={openClients}>
                  + New client
                </button>
              </div>
              <div className="toolbar">
                <input
                  aria-label="Search clients"
                  placeholder="Search clients…"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setPage(0);
                  }}
                />
                <select
                  aria-label="Sort clients"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="name">Name A–Z</option>
                  <option value="reverse">Name Z–A</option>
                </select>
                <span className="muted">{filtered.length} clients</span>
              </div>
              {filtered.length ? (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th>Type</th>
                          <th>Email</th>
                          <th>Phone</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.slice(page * 20, page * 20 + 20).map((c) => (
                          <tr key={c.id}>
                            <td>
                              <button
                                className="link"
                                onClick={() => navigate("clients", c.id)}
                              >
                                {c.name}
                              </button>
                            </td>
                            <td>
                              <Tag>{c.type}</Tag>
                            </td>
                            <td>{c.email || "—"}</td>
                            <td>{c.phone || "—"}</td>
                            <td>
                              <button
                                onClick={() => {
                                  setEditClient(c);
                                  setModal("client");
                                }}
                              >
                                Edit
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
                      Previous
                    </button>
                    <span>
                      Page {page + 1} of {Math.ceil(filtered.length / 20)}
                    </span>
                    <button
                      disabled={(page + 1) * 20 >= filtered.length}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : (
                <Empty
                  title={filter ? "No matching clients" : "No clients yet"}
                >
                  Use New client to add the first person or business you
                  support.
                </Empty>
              )}
            </>
          )}
          {view === "clients" &&
            recordId &&
            (detail ? (
              <>
                <button
                  className="link back"
                  onClick={() => navigate("clients")}
                >
                  ← All clients
                </button>
                <div className="page-heading">
                  <div>
                    <Tag>{detail.type}</Tag>
                    <h1>{detail.name}</h1>
                    <p>
                      {detail.email || "No email"} ·{" "}
                      {detail.phone || "No phone"}
                    </p>
                  </div>
                  <div className="actions">
                    <button
                      onClick={() => {
                        setEditClient(detail);
                        setModal("client");
                      }}
                    >
                      Edit client
                    </button>
                    <button
                      className="primary"
                      onClick={() => {
                        setSuggestedJob(null);
                        setDraftClient("");
                        setModal("activity");
                      }}
                    >
                      + Log activity
                    </button>
                  </div>
                </div>
                <div className="dashboard-grid">
                  <section className="card">
                    <div className="section-heading">
                      <h2>Work</h2>
                      <span className="muted">
                        {detail.activities.length} activities
                      </span>
                    </div>
                    {detail.activities.length ? (
                      <ActivityTable
                        activities={detail.activities}
                        onOpen={(a) => navigate("work", a.id)}
                      />
                    ) : (
                      <p className="muted">No activities recorded.</p>
                    )}
                    <div className="section-heading">
                      <h2>Contextual notes</h2>
                      <button onClick={() => setModal("note")}>Add note</button>
                    </div>
                    <Notes
                      notes={detail.notes}
                      remove={(id) =>
                        void run(async () => {
                          if (!confirm("Delete this note?")) return;
                          await request("notes/" + id, "DELETE");
                          await reloadDetail();
                        })
                      }
                    />
                  </section>
                  <div className="stack">
                    <section className="card">
                      <div className="section-heading">
                        <h2>Contacts</h2>
                        <button onClick={() => setModal("contact")}>
                          Add contact
                        </button>
                      </div>
                      {detail.contacts.map((c) => (
                        <div className="contact" key={c.id}>
                          <strong>{c.name}</strong>
                          <small>
                            {c.role} {c.email} {c.phone}
                          </small>
                          <button
                            className="quiet"
                            onClick={() =>
                              void run(async () => {
                                if (!confirm("Remove this contact?")) return;
                                await request("contacts/" + c.id, "DELETE");
                                await reloadDetail();
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      {!detail.contacts.length && (
                        <p className="muted">No additional contacts.</p>
                      )}
                      <p className="preserve">{detail.billing_address}</p>
                    </section>
                    <section className="card">
                      <h2>Credential metadata</h2>
                      <p className="muted">
                        Secret fields are available only in the vault.
                      </p>
                      {detail.credentials.map((c) => (
                        <p key={c.id}>{c.title}</p>
                      ))}
                      <button onClick={() => navigate("credentials")}>
                        Open credentials
                      </button>
                    </section>
                    <ClientBillingLinks
                      clientId={detail.id}
                      onNavigate={navigate}
                    />
                    <button
                      className="danger-text"
                      onClick={() =>
                        void run(async () => {
                          if (
                            !confirm(
                              "Archive this client? Historical work and encrypted credentials will be retained.",
                            )
                          )
                            return;
                          await request("clients/" + recordId, "DELETE");
                          await refresh();
                          navigate("clients");
                          notify("Client archived.");
                        })
                      }
                    >
                      Archive client
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p role="status">Loading client…</p>
            ))}
          {view === "work" && !recordId && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">EVERYDAY WORK</p>
                  <h1>Activities</h1>
                  <p>
                    Log a small task now, or organize related work into a job.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={!clients.length}
                  onClick={() => {
                    setSuggestedJob(null);
                    setDraftClient("");
                    setModal("activity");
                  }}
                >
                  + New activity
                </button>
              </div>
              <div className="toolbar">
                <Tag>Activities</Tag>
                <button onClick={() => navigate("jobs")}>Jobs</button>
                <button onClick={() => navigate("sales", "unbilled")}>
                  Unbilled work
                </button>
              </div>
              <div className="toolbar">
                <input
                  aria-label="Search activities"
                  placeholder="Search work or client…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              {activities.length ? (
                <ActivityTable
                  activities={activities.filter((a) =>
                    (a.title + " " + a.client_name)
                      .toLowerCase()
                      .includes(filter.toLowerCase()),
                  )}
                  onOpen={(a) => navigate("work", a.id)}
                />
              ) : (
                <Empty title="No activities yet">
                  Create a client and log work directly. A job is optional.
                </Empty>
              )}
            </>
          )}
          {view === "work" &&
            recordId &&
            (activityDetail ? (
              <>
                <button className="link back" onClick={() => navigate("work")}>
                  ← All activities
                </button>
                <div className="page-heading">
                  <div>
                    <Tag>{activityDetail.status}</Tag>
                    <h1>{activityDetail.title}</h1>
                    <button
                      className="link"
                      onClick={() =>
                        navigate("clients", activityDetail.client_id)
                      }
                    >
                      {activityDetail.client_name}
                    </button>
                  </div>
                  <div className="actions">
                    <button onClick={() => setModal("time")}>
                      Log manual time
                    </button>
                    <button
                      className="primary"
                      disabled={!!timer || busy}
                      onClick={() => void timerAction("start", recordId)}
                    >
                      Start timer
                    </button>
                  </div>
                </div>
                <div className="dashboard-grid">
                  <section className="card">
                    <h2>Time entries</h2>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Duration</th>
                            <th>Source</th>
                            <th>Rate snapshot</th>
                            <th>Billable</th>
                            <th>Billing</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activityDetail.entries.map((e) => (
                            <tr key={e.id}>
                              <td className="numeric">
                                {duration(e.duration_seconds)}
                              </td>
                              <td>{e.source}</td>
                              <td>
                                {money(Number(e.rate_minor))}/h ·{" "}
                                {e.rounding_minutes}m
                              </td>
                              <td>{e.billable ? "Yes" : "No"}</td>
                              <td>
                                {e.allocated ? (
                                  <Tag>Reserved / billed</Tag>
                                ) : (
                                  <button onClick={() => setReviewTime(e)}>
                                    Review billing
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!activityDetail.entries.length && (
                      <p className="muted">
                        No saved time. Running timers are saved when stopped.
                      </p>
                    )}
                    <div className="section-heading">
                      <h2>Notes</h2>
                      <button onClick={() => setModal("note")}>Add note</button>
                    </div>
                    <Notes
                      notes={activityDetail.notes}
                      remove={(id) =>
                        void run(async () => {
                          if (!confirm("Delete this note?")) return;
                          await request("notes/" + id, "DELETE");
                          await reloadDetail();
                        })
                      }
                    />
                  </section>
                  <section className="card">
                    <h2>Activity details</h2>
                    <form
                      className="stack"
                      key={activityDetail.version}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        void run(async () => {
                          await request("activities/" + recordId, "PUT", {
                            title: value(fd, "title"),
                            status: value(fd, "status"),
                            billable: fd.has("billable"),
                            notes: value(fd, "notes"),
                            version: activityDetail.version,
                            job_id: value(fd, "job_id") || null,
                          });
                          await refresh();
                          await reloadDetail();
                          notify(
                            "Activity updated. Existing billing snapshots preserved.",
                          );
                        });
                      }}
                    >
                      <Field label="Title">
                        <input
                          name="title"
                          defaultValue={activityDetail.title}
                          required
                          maxLength={500}
                        />
                      </Field>
                      <Field label="Status">
                        <select
                          name="status"
                          defaultValue={activityDetail.status}
                        >
                          <option value="open">Open</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </Field>
                      <label className="check">
                        <input
                          name="billable"
                          type="checkbox"
                          defaultChecked={activityDetail.billable}
                        />
                        Billable
                      </label>
                      <Field label="Description / notes">
                        <textarea
                          name="notes"
                          defaultValue={activityDetail.activity_notes}
                          maxLength={20000}
                        />
                      </Field>
                      <button disabled={busy}>Save activity</button>
                    </form>
                  </section>
                </div>
              </>
            ) : (
              <p role="status">Loading activity…</p>
            ))}
          {view === "credentials" && (
            <VaultPanel
              clients={clients}
              idleMinutes={state.settings.vault_idle_minutes}
              lockSignal={lockSignal}
              notify={notify}
              onLockState={handleVaultState}
            />
          )}
          {view === "jobs" && (
            <JobsPanel
              key={recordId}
              clients={clients}
              recordId={recordId}
              onNavigate={navigate}
              notify={notify}
              onActivity={(j) => {
                setSuggestedJob(j);
                setDraftClient(j.client_id);
                setJobs((v) => [...v.filter((x) => x.id !== j.id), j]);
                setModal("activity");
              }}
            />
          )}
          {view === "sales" && (
            <SalesPanel
              key={recordId}
              clients={clients}
              settings={state.settings}
              recordId={recordId}
              onNavigate={navigate}
              notify={notify}
            />
          )}
          {view === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">MAKE IT YOURS</p>
                  <h1>Settings</h1>
                  <p>Business defaults, deployment health and security.</p>
                </div>
              </div>
              <div className="dashboard-grid">
                <section className="card">
                  <h2>Business & billing defaults</h2>
                  <form
                    className="stack"
                    onSubmit={saveSettings}
                    key={state.settings.version}
                  >
                    <Field label="Business or personal name">
                      <input
                        name="name"
                        defaultValue={state.settings.name}
                        required
                      />
                    </Field>
                    <Field label="Timezone">
                      <input
                        name="timezone"
                        defaultValue={state.settings.timezone}
                        required
                      />
                    </Field>
                    <Field label="Default hourly rate (CAD)">
                      <input
                        name="rate"
                        type="number"
                        min="0"
                        max="1000000"
                        step="0.01"
                        defaultValue={
                          Number(state.settings.hourly_rate_minor) / 100
                        }
                        required
                      />
                    </Field>
                    <Field label="Rounding increment (minutes)">
                      <select
                        name="rounding"
                        defaultValue={state.settings.rounding_minutes}
                      >
                        {[1, 5, 6, 10, 15, 30, 60].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Invoice prefix">
                      <input
                        name="prefix"
                        defaultValue={state.settings.invoice_prefix}
                        maxLength={20}
                        required
                      />
                    </Field>
                    <label className="check">
                      <input
                        name="tax_enabled"
                        type="checkbox"
                        defaultChecked={state.settings.tax_enabled}
                      />
                      Enable tax rates on invoice lines
                    </label>
                    <Field label="Vault idle lock (minutes)">
                      <input
                        name="idle"
                        type="number"
                        min="1"
                        max="60"
                        defaultValue={state.settings.vault_idle_minutes}
                        required
                      />
                    </Field>
                    <button className="primary" disabled={busy}>
                      Save settings
                    </button>
                  </form>
                </section>
                <div className="stack">
                  <section className="card">
                    <h2>Security</h2>
                    <p className="alert">{recommendation}</p>
                    <p>
                      Browser secure context:{" "}
                      <strong>
                        {globalThis.isSecureContext ? "Yes" : "No"}
                      </strong>
                      . A VPN reduces exposure; it does not replace TLS or
                      trusted application code.
                    </p>
                    <p className="muted">
                      Vault keys are never persisted. The vault locks when
                      hidden or when you leave Credentials. Account recovery and
                      vault recovery are separate.
                    </p>
                    <button onClick={() => setModal("password")}>
                      Change login password
                    </button>
                  </section>
                  <section className="card">
                    <h2>Storage & backup</h2>
                    <p>
                      Backups include database ciphertext, key envelopes and
                      private files. Keep deployment secrets and your vault
                      recovery key separately.
                    </p>
                    <div className="actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            setDiagnostics(await request("diagnostics"));
                          })
                        }
                      >
                        Check storage
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await request("backup", "POST", {});
                            notify(
                              "Consistent backup created with checksum manifest. Test restore before relying on it.",
                            );
                          })
                        }
                      >
                        Create backup
                      </button>
                    </div>
                    {diagnostics && (
                      <p>
                        Uploads:{" "}
                        {diagnostics.uploads ? "Writable" : "Unavailable"} ·
                        Backups:{" "}
                        {diagnostics.backups ? "Writable" : "Unavailable"}
                      </p>
                    )}
                    <p className="muted">
                      SMTP is optional and will be added in Milestone 3. Restore
                      is an operator procedure documented in the repository.
                    </p>
                  </section>
                </div>
              </div>
              <div className="settings-extra">
                <BusinessProfile
                  settings={state.settings}
                  onSaved={refresh}
                  notify={notify}
                />
              </div>
            </>
          )}
        </main>
        <footer className="app-footer">
          SideDesk · Your independent workspace{" "}
          <span>Credential vault: independent security review required</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {reviewTime && (
        <TimeReviewDialog
          entry={reviewTime}
          onClose={() => setReviewTime(null)}
          onSaved={async () => {
            setReviewTime(null);
            await reloadDetail();
            await refresh();
            notify("Time-entry billing review saved.");
          }}
        />
      )}
      {modal && (
        <Dialog
          drawer={modal !== "search" && modal !== "password"}
          title={
            {
              client: editClient ? "Edit client" : "New client",
              activity: "Log activity",
              contact: "New contact",
              note: "Add contextual note",
              time: "Log manual time",
              search: "Search workspace",
              password: "Change login password",
            }[modal]
          }
          onClose={() => {
            setModal(null);
            setError("");
          }}
        >
          {error && (
            <p className="alert danger" role="alert">
              {error}
            </p>
          )}
          {modal === "search" ? (
            <div className="stack">
              <input
                autoFocus
                aria-label="Search workspace"
                placeholder="Client, activity, credential title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search &&
                clients
                  .filter((c) =>
                    c.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .slice(0, 10)
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setModal(null);
                        navigate("clients", c.id);
                      }}
                    >
                      {c.name} <Tag>Client</Tag>
                    </button>
                  ))}
              {search &&
                activities
                  .filter((a) =>
                    a.title.toLowerCase().includes(search.toLowerCase()),
                  )
                  .slice(0, 10)
                  .map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        setModal(null);
                        navigate("work", a.id);
                      }}
                    >
                      {a.title} <Tag>Activity</Tag>
                    </button>
                  ))}
              <p className="muted">
                Search covers safe client and activity metadata. Credential
                values are never indexed; browse titles in Credentials.
              </p>
            </div>
          ) : (
            <form className="stack" onSubmit={saveForm}>
              {modal === "client" && (
                <>
                  <Field label="Client name">
                    <input
                      name="name"
                      defaultValue={editClient?.name}
                      required
                      maxLength={160}
                    />
                  </Field>
                  <Field label="Type">
                    <select
                      name="type"
                      defaultValue={editClient?.type || "business"}
                    >
                      <option value="business">Business</option>
                      <option value="person">Person</option>
                    </select>
                  </Field>
                  <Field label="Email">
                    <input
                      name="email"
                      type="email"
                      defaultValue={editClient?.email}
                    />
                  </Field>
                  <Field label="Phone">
                    <input
                      name="phone"
                      defaultValue={editClient?.phone}
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Billing address">
                    <textarea
                      name="billing_address"
                      defaultValue={editClient?.billing_address}
                      maxLength={1000}
                    />
                  </Field>
                  <Field
                    label="Hourly rate override (CAD)"
                    hint="Leave blank to use the business default."
                  >
                    <input
                      name="rate"
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.01"
                      defaultValue={
                        editClient?.hourly_rate_minor == null
                          ? ""
                          : Number(editClient.hourly_rate_minor) / 100
                      }
                    />
                  </Field>
                </>
              )}
              {modal === "activity" && (
                <>
                  <Field label="Client">
                    <select
                      name="client_id"
                      defaultValue={
                        suggestedJob?.client_id ||
                        (view === "clients" && recordId
                          ? recordId
                          : clients[0]?.id)
                      }
                      onChange={(e) => setDraftClient(e.target.value)}
                      required
                    >
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Job (optional)">
                    <select name="job_id" defaultValue={suggestedJob?.id || ""}>
                      <option value="">No job - quick activity</option>
                      {jobs
                        .filter(
                          (j) =>
                            j.client_id ===
                            (draftClient ||
                              suggestedJob?.client_id ||
                              (view === "clients" && recordId
                                ? recordId
                                : clients[0]?.id)),
                        )
                        .map((j) => (
                          <option key={j.id} value={j.id}>
                            {j.title}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field
                    label="Manual time hourly rate override (CAD)"
                    hint="Blank uses job, client, then business default."
                  >
                    <input
                      name="rate_override"
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.01"
                    />
                  </Field>
                  <Field label="Activity title">
                    <input name="title" required maxLength={500} />
                  </Field>
                  <Field label="Manual duration (minutes)">
                    <input
                      name="minutes"
                      type="number"
                      min="0"
                      max="525600"
                      step="0.1"
                      defaultValue="0"
                    />
                  </Field>
                  <label className="check">
                    <input name="billable" type="checkbox" defaultChecked />
                    Billable
                  </label>
                  <label className="check">
                    <input
                      name="start_timer"
                      type="checkbox"
                      disabled={!!timer}
                    />
                    Start a timer after saving
                  </label>
                  <Field label="Notes">
                    <textarea name="notes" maxLength={20000} />
                  </Field>
                </>
              )}
              {modal === "contact" && (
                <>
                  <Field label="Contact name">
                    <input name="name" required />
                  </Field>
                  <Field label="Role">
                    <input name="role" maxLength={80} />
                  </Field>
                  <Field label="Email">
                    <input type="email" name="email" />
                  </Field>
                  <Field label="Phone">
                    <input name="phone" maxLength={80} />
                  </Field>
                </>
              )}
              {modal === "note" && (
                <Field
                  label="Note"
                  hint="Markdown is supported. Raw HTML is never executed."
                >
                  <textarea name="body" maxLength={20000} rows={8} required />
                </Field>
              )}
              {modal === "time" && (
                <>
                  <Field
                    label="Hourly rate override (CAD)"
                    hint="Blank uses job, client, then business default."
                  >
                    <input
                      type="number"
                      name="rate_override"
                      min="0"
                      max="1000000"
                      step="0.01"
                    />
                  </Field>
                  <Field label="Duration (minutes)">
                    <input
                      type="number"
                      name="minutes"
                      min="0.1"
                      max="525600"
                      step="0.1"
                      required
                    />
                  </Field>
                </>
              )}
              {modal === "password" && (
                <>
                  <Field label="Current login password">
                    <input
                      type="password"
                      name="current"
                      autoComplete="current-password"
                      required
                    />
                  </Field>
                  <Field
                    label="New login password"
                    hint="14–256 characters. All sessions will be signed out."
                  >
                    <input
                      type="password"
                      name="password"
                      minLength={14}
                      maxLength={256}
                      autoComplete="new-password"
                      required
                    />
                  </Field>
                </>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </form>
          )}
        </Dialog>
      )}
    </div>
  );
}
function selectSettings(s: Settings) {
  return {
    name: s.name,
    timezone: s.timezone,
    hourly_rate_minor: Number(s.hourly_rate_minor),
    rounding_minutes: s.rounding_minutes,
    invoice_prefix: s.invoice_prefix,
    tax_enabled: s.tax_enabled,
    vault_idle_minutes: s.vault_idle_minutes,
    https_dismissed: s.https_dismissed,
    version: s.version,
  };
}
function Theme({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label="Theme"
      className="theme-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}
function money(minor: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(minor / 100);
}
function ActivityTable({
  activities,
  onOpen,
}: {
  activities: Activity[];
  onOpen: (a: Activity) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Activity</th>
            <th>Client</th>
            <th>Status</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((a) => (
            <tr key={a.id}>
              <td>
                <button className="link" onClick={() => onOpen(a)}>
                  {a.title}
                </button>
              </td>
              <td>{a.client_name || "Client work"}</td>
              <td>
                <Tag>{a.status}</Tag>
              </td>
              <td className="numeric">{duration(a.duration_seconds || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Notes({
  notes,
  remove,
}: {
  notes: Note[];
  remove: (id: string) => void;
}) {
  return notes.length ? (
    <div className="notes">
      {notes.map((n) => (
        <article key={n.id}>
          <div className="note-body">
            <Markdown skipHtml>{n.body}</Markdown>
          </div>
          <div className="row">
            <small>{new Date(n.created_at).toLocaleString()}</small>
            <button className="quiet" onClick={() => remove(n.id)}>
              Delete note
            </button>
          </div>
        </article>
      ))}
    </div>
  ) : (
    <p className="muted">No notes yet. Keep context with this record.</p>
  );
}
