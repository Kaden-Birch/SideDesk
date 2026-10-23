"use client";
import { useState, useEffect } from "react";
import { request } from "@/lib/client";
import { money } from "./money";
import type { Invoice, Line } from "./model";
import type { Quote } from "@/features/quotes/service";
function pricing(lines: Line[]) {
  return lines.map((l) => ({
    description: l.description,
    quantity: Number(l.quantity),
    unit_minor: l.unit_minor,
    discount_bps: l.discount_bps,
    tax_minor: l.tax_minor,
    tax_treatment: l.tax_treatment,
    tax_snapshot: l.tax_snapshot,
    total_minor: l.total_minor,
  }));
}
export default function QuoteOrigin({
  invoice,
  onNavigate,
}: {
  invoice: Invoice;
  onNavigate: (view: string, id?: string) => void;
}) {
  const [quote, setQuote] = useState<Quote | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (invoice.source_quote_id)
      void request<Quote>("quotes/" + invoice.source_quote_id)
        .then(setQuote)
        .catch((e) => setError(e.message));
  }, [invoice.source_quote_id]);
  if (!invoice.source_quote_id) return null;
  const changed =
    (quote &&
      JSON.stringify(pricing(invoice.lines)) !==
        JSON.stringify(pricing(quote.document.lines))) ||
    Boolean(
      quote &&
      (invoice.notes !== quote.document.notes ||
        invoice.terms !== quote.document.terms),
    );
  return (
    <section className="card">
      <h2>Accepted quote reference</h2>
      {error && <p role="alert">{error}</p>}
      {quote ? (
        <>
          <button
            className="link"
            onClick={() => onNavigate("quotes", quote.id)}
          >
            {quote.number}
          </button>
          <p className={changed ? "notice" : "muted"}>
            {changed
              ? "This saved invoice differs from the accepted scope, quantities, prices, taxes or terms. Review the agreed lines before issue."
              : "Saved invoice lines match the accepted quote."}
          </p>
          <details>
            <summary>Compare agreed lines with saved invoice</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agreed description</th>
                    <th>Quantity</th>
                    <th>Unit CAD</th>
                    <th>Total CAD</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.document.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td>{Number(l.quantity)}</td>
                      <td>{money(l.unit_minor)}</td>
                      <td>{money(l.total_minor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Agreed notes and terms</h3>
            <p className="preserve">{quote.document.notes}</p>
            <p className="preserve">{quote.document.terms}</p>
            <p>
              Accepted total:{" "}
              <strong>{money(quote.document.total_minor)}</strong> · Saved
              invoice: <strong>{money(invoice.total_minor)}</strong>
            </p>
          </details>
        </>
      ) : (
        <p>Loading agreed snapshot…</p>
      )}
    </section>
  );
}
