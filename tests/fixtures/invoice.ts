import type { InvoiceSnapshot, Line } from "../../features/billing/model";
import { manualAmounts, timeAmounts } from "../../features/billing/money";
export function invoiceFixture(
  paper: "Letter" | "A4" = "Letter",
  multipage = false,
): InvoiceSnapshot {
  const lines: Line[] = multipage
    ? Array.from({ length: 60 }, (_, n) => ({
        id: `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
        kind: "manual",
        description: `Service item ${String(n + 1).padStart(2, "0")} - Fictional configuration, verification and documented handover for the client workstation. Customer-visible scope only.`,
        quantity: "1",
        unit_minor: 12000,
        discount_bps: 0,
        tax_bps: 500,
        tax_label: "Configured tax",
        ...manualAmounts("1", 12000, 0, 500),
        original_seconds: null,
        billable_seconds: null,
        source_snapshot: [],
      }))
    : [
        {
          id: "00000000-0000-4000-8000-000000000001",
          kind: "time",
          description: "Workstation diagnostic and service",
          quantity: "0.5",
          unit_minor: 12000,
          discount_bps: 0,
          tax_bps: 500,
          tax_label: "Configured tax",
          ...timeAmounts(1800, 12000, 0, 500),
          original_seconds: 1500,
          billable_seconds: 1800,
          source_snapshot: [],
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          kind: "manual",
          description: "Configured device supply",
          quantity: "2",
          unit_minor: 4500,
          discount_bps: 1000,
          tax_bps: 500,
          tax_label: "Configured tax",
          ...manualAmounts("2", 4500, 1000, 500),
          original_seconds: null,
          billable_seconds: null,
          source_snapshot: [],
        },
      ];
  const sum = (
    f: "subtotal_minor" | "discount_minor" | "tax_minor" | "total_minor",
  ) => lines.reduce((n, l) => n + l[f], 0);
  return {
    format: 1,
    number: multipage ? "DEMO-000002" : "DEMO-000001",
    issue_date: "2026-10-23",
    due_date: "2026-11-22",
    paper,
    currency: "CAD",
    issuer: {
      name: "Prairie Demo IT Studio",
      address: "100 Fictional Street\nEdmonton, AB",
      email: "demo@example.invalid",
      phone: "",
      registration_number: "DEMO - NOT A REAL REGISTRATION",
    },
    client: {
      name: "Prairie Demo Studio",
      contact: "Demo Contact",
      address: "200 Example Avenue\nEdmonton, AB",
      email: "client@example.invalid",
      phone: "",
    },
    accent: "#365f9b",
    payment_instructions:
      "Fictional payment instructions. Contact the issuer to arrange payment.\nThis is demonstration data only.",
    notes:
      "Thank you for your business. All names, addresses and amounts in this document are fictional.",
    terms:
      "Payment due within 30 days. Please include the invoice number with your payment.",
    lines,
    subtotal_minor: sum("subtotal_minor"),
    discount_minor: sum("discount_minor"),
    tax_minor: sum("tax_minor"),
    total_minor: sum("total_minor"),
    received_minor: 0,
    balance_minor: sum("total_minor"),
  };
}
