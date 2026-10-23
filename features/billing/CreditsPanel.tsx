"use client";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import { request, requestKey } from "@/lib/client";
import { Dialog, Field, Tag } from "@/components/ui";
import { money, parseDecimal } from "./money";
import type { Invoice } from "./model";
import { todayIn } from "@/lib/dates";
type Adjustment = {
  id: string;
  kind: "credit" | "credit_reversal" | "refund" | "refund_reversal";
  amount_minor: string;
  tax_minor: string;
  occurred_on: string;
  reason: string;
  method: string;
  reference: string;
  reverses_id: string | null;
};
export default function CreditsPanel({
  invoice,
  timezone,
  onChanged,
  notify,
}: {
  invoice: Invoice;
  timezone: string;
  onChanged: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const actionKey = useRef<string | null>(null);
  const [rows, setRows] = useState<Adjustment[]>([]),
    [dialog, setDialog] = useState<"credit" | "refund" | Adjustment | null>(
      null,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async () =>
      setRows(
        await request<Adjustment[]>("invoices/" + invoice.id + "/adjustments"),
      ),
    [invoice.id],
  );
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, [load]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dialog) return;
    const fd = new FormData(e.currentTarget),
      reason = String(fd.get("reason"));
    setBusy(true);
    setError("");
    try {
      const key = (actionKey.current ||= await requestKey());
      if (typeof dialog === "object")
        await request(
          "invoices/" + invoice.id + "/adjustments/" + dialog.id + "/reverse",
          "POST",
          { reason },
          key,
        );
      else
        await request(
          "invoices/" + invoice.id + "/adjustments",
          "POST",
          {
            kind: dialog,
            amount_minor: parseDecimal(String(fd.get("amount"))),
            tax_minor:
              dialog === "credit"
                ? parseDecimal(String(fd.get("tax") || "0"))
                : 0,
            occurred_on: String(fd.get("date")),
            reason,
            method: String(fd.get("method") || "other"),
            reference: String(fd.get("reference") || ""),
          },
          key,
        );
      await load();
      await onChanged();
      setDialog(null);
      notify(
        "Financial adjustment recorded. The issued invoice and PDF remain unchanged.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Credits & refunds</h2>
      <dl className="invoice-summary">
        <div>
          <dt>Credits applied</dt>
          <dd>{money(invoice.credit_minor || 0)}</dd>
        </div>
        <div>
          <dt>Refundable customer credit</dt>
          <dd>{money(invoice.customer_credit_minor || 0)}</dd>
        </div>
      </dl>
      <p className="muted">
        Credits reduce the customer obligation. Refunds record money returned
        outside SideDesk; no bank transfer is initiated.
      </p>
      <div className="actions">
        <button
          onClick={() => {
            actionKey.current = null;
            setDialog("credit");
            setError("");
          }}
          disabled={
            invoice.state !== "issued" ||
            (invoice.credit_minor || 0) >= invoice.total_minor
          }
        >
          Add credit
        </button>
        <button
          onClick={() => {
            actionKey.current = null;
            setDialog("refund");
            setError("");
          }}
          disabled={
            invoice.state !== "issued" || !(invoice.customer_credit_minor || 0)
          }
        >
          Record refund
        </button>
      </div>
      {error && !dialog && <p role="alert">{error}</p>}
      {rows.map((a) => (
        <div className="history-event" key={a.id}>
          <strong>{money(a.amount_minor)}</strong>{" "}
          <Tag>{a.kind.replaceAll("_", " ")}</Tag>
          <p>{a.reason}</p>
          {a.kind.startsWith("credit") && (
            <small>Tax included: {money(a.tax_minor)}</small>
          )}
          <small>
            {a.occurred_on} · {a.method.replaceAll("_", " ")} {a.reference}
          </small>
          {invoice.state === "issued" &&
            ["credit", "refund"].includes(a.kind) &&
            !rows.some((r) => r.reverses_id === a.id) && (
              <div>
                <button
                  onClick={() => {
                    actionKey.current = null;
                    setDialog(a);
                    setError("");
                  }}
                >
                  Reverse {a.kind}
                </button>
              </div>
            )}
        </div>
      ))}
      {!rows.length && <p>No credits or refunds recorded.</p>}
      {dialog && (
        <Dialog
          title={
            typeof dialog === "object"
              ? "Reverse financial adjustment"
              : dialog === "credit"
                ? "Add invoice credit"
                : "Record external refund"
          }
          onClose={() => setDialog(null)}
          drawer
        >
          <form onSubmit={save}>
            {typeof dialog === "object" ? (
              <p>
                Reverse the {money(dialog.amount_minor)} {dialog.kind}. Both
                events remain in history. This only corrects the recorded event.
              </p>
            ) : (
              <>
                <Field
                  label={
                    dialog === "credit"
                      ? "Credit amount (CAD)"
                      : "Refund amount (CAD)"
                  }
                >
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    max={(
                      (dialog === "credit"
                        ? invoice.total_minor - (invoice.credit_minor || 0)
                        : invoice.customer_credit_minor || 0) / 100
                    ).toFixed(2)}
                  />
                </Field>
                {dialog === "credit" && (
                  <Field
                    label="Tax included in credit (CAD)"
                    hint={`Remaining invoice tax: ${money(invoice.tax_minor - (invoice.credit_tax_minor || 0))}. This is part of the credit, not added to it. Enter the explicit tax correction; none is assumed.`}
                  >
                    <input
                      name="tax"
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue="0.00"
                      max={(
                        (invoice.tax_minor - (invoice.credit_tax_minor || 0)) /
                        100
                      ).toFixed(2)}
                    />
                  </Field>
                )}
                <Field label="Adjustment date">
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={todayIn(timezone)}
                  />
                </Field>
                {dialog === "refund" && (
                  <>
                    <Field label="Refund method">
                      <select name="method">
                        <option value="e_transfer">E-transfer</option>
                        <option value="cash">Cash</option>
                        <option value="cheque">Cheque</option>
                        <option value="other">Other</option>
                      </select>
                    </Field>
                    <Field label="Refund reference">
                      <input name="reference" maxLength={160} />
                    </Field>
                    <label className="check">
                      <input type="checkbox" required />
                      The money was returned outside SideDesk.
                    </label>
                  </>
                )}
              </>
            )}
            <Field label="Adjustment reason">
              <textarea name="reason" required maxLength={1000} rows={3} />
            </Field>
            {error && <p role="alert">{error}</p>}
            <div className="actions">
              <button className="primary" disabled={busy}>
                {typeof dialog === "object"
                  ? "Confirm reversal"
                  : dialog === "credit"
                    ? "Record credit"
                    : "Confirm recorded refund"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
