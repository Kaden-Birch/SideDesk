"use client";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import { formatTimestamp } from "@/lib/dates";
import { request, requestKey } from "@/lib/client";
import { Dialog, Field, Tag } from "@/components/ui";
type Attempt = {
  id: string;
  recipient: string;
  subject: string;
  created_at: string;
  outcome: "accepted" | "failed" | "unknown" | "pending";
  summary: string | null;
  document_sha256: string;
};
export default function DocumentEmail({
  kind,
  id,
  recipient,
  number,
  onSent,
  notify,
  timezone,
  canSend = true,
}: {
  kind: "invoice" | "quote";
  timezone: string;
  canSend?: boolean;
  id: string;
  recipient: string;
  number: string;
  onSent: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [rows, setRows] = useState<Attempt[]>([]),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef<string | null>(null);
  const path = (kind === "invoice" ? "invoices/" : "quotes/") + id + "/email";
  const load = useCallback(
    async () => setRows(await request<Attempt[]>(path)),
    [path],
  );
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, [load]);
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      key.current ||= await requestKey();
      const result = await request<{ summary: string }>(
        path,
        "POST",
        {
          recipient: String(fd.get("recipient")),
          subject: String(fd.get("subject")),
          body: String(fd.get("body") || ""),
        },
        key.current,
      );
      await load();
      await onSent();
      notify(
        result.summary ||
          "An existing attempt was found. Check its recorded status before retrying.",
      );
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="section-heading">
        <h2>Email history</h2>
        <button
          disabled={!canSend}
          title={!canSend ? "This document state cannot be emailed" : undefined}
          onClick={() => {
            key.current = null;
            setError("");
            setOpen(true);
          }}
        >
          Email PDF
        </button>
      </div>
      <p className="muted">
        The exact published PDF is attached. “Accepted” means the SMTP server
        accepted it, not confirmed delivery.
      </p>
      {error && !open && <p role="alert">{error}</p>}
      {rows.length ? (
        rows.map((a) => (
          <div className="history-event" key={a.id}>
            <strong>{a.subject}</strong> <Tag>{a.outcome}</Tag>
            <p>{a.recipient}</p>
            <small>{formatTimestamp(a.created_at, timezone)}</small>
            <p>
              {a.summary ||
                "No final outcome recorded. Check the mail server before explicitly starting another attempt."}
            </p>
          </div>
        ))
      ) : (
        <p>No email attempts recorded.</p>
      )}
      {open && (
        <Dialog
          title="Email published PDF"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          drawer
        >
          <form onSubmit={send}>
            <p>
              This sends the exact {number} PDF using saved SMTP settings. It
              cannot be recalled by SideDesk.
            </p>
            {rows.some(
              (a) => a.outcome === "unknown" || a.outcome === "pending",
            ) && (
              <p className="notice">
                A previous outcome is uncertain. Check the mail server and
                recipient before creating another attempt; another send can
                create a duplicate.
              </p>
            )}
            <Field label="Email recipient">
              <input
                name="recipient"
                type="email"
                required
                maxLength={254}
                defaultValue={recipient}
              />
            </Field>
            <Field label="Email subject">
              <input
                name="subject"
                required
                maxLength={200}
                defaultValue={`${kind === "invoice" ? "Invoice" : "Quote"} ${number}`}
              />
            </Field>
            <Field label="Email message">
              <textarea
                name="body"
                maxLength={6000}
                rows={5}
                defaultValue="Please find the attached document."
              />
            </Field>
            <label className="check">
              <input type="checkbox" required />I reviewed the recipient and
              existing email history.
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="actions">
              <button className="primary" disabled={busy}>
                Send PDF
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
