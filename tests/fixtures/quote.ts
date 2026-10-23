import { invoiceFixture } from "./invoice";
import { calculateTaxes } from "../../features/billing/taxes";
import type { InvoiceSnapshot } from "../../features/billing/model";
export function quoteFixture(
  paper: "Letter" | "A4" = "Letter",
  multi = false,
): InvoiceSnapshot {
  const base = invoiceFixture(paper, multi);
  const lines = base.lines.map((l) => {
    const subtotal = l.subtotal_minor,
      discount = l.discount_minor;
    const tax_snapshot = calculateTaxes(subtotal - discount, [
      { label: "Configured GST", rate_milli_percent: 5000, compound: false },
      { label: "Configured QST", rate_milli_percent: 9975, compound: false },
    ]);
    const tax_minor = tax_snapshot.reduce((n, t) => n + t.amount_minor, 0);
    return {
      ...l,
      kind: "manual" as const,
      original_seconds: null,
      billable_seconds: null,
      description:
        l.kind === "time"
          ? "Fictional fixed workstation service"
          : l.description,
      tax_bps: 0,
      tax_label: "Configured GST + QST",
      tax_snapshot,
      tax_treatment: "taxable" as const,
      tax_minor,
      total_minor: subtotal - discount + tax_minor,
    };
  });
  return {
    ...base,
    document_kind: "QUOTE",
    number: multi ? "QUO-DEMO-000002" : "QUO-DEMO-000001",
    lines,
    tax_minor: lines.reduce((n, l) => n + l.tax_minor, 0),
    total_minor: lines.reduce((n, l) => n + l.total_minor, 0),
    payment_instructions: "",
    notes:
      "Fictional proposal only. Scope and acceptance are recorded separately.",
    terms:
      "Valid through the stated expiry date. Prices exclude any work not explicitly described.",
  };
}
