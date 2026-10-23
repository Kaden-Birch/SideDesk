import { chromium } from "playwright";
import { HttpError } from "@/lib/auth";
import { money } from "./money";
import type { InvoiceSnapshot, Party } from "./model";
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function party(p: Party) {
  return `<strong>${escape(p.name)}</strong>${p.contact ? `<div>${escape(p.contact)}</div>` : ""}<div class="preserve">${escape(p.address)}</div>${p.email ? `<div>${escape(p.email)}</div>` : ""}${p.phone ? `<div>${escape(p.phone)}</div>` : ""}`;
}
export function invoiceHTML(s: InvoiceSnapshot) {
  const taxGroups = new Map<string, number>();
  for (const l of s.lines)
    if (l.tax_minor) {
      const label = `${l.tax_label} (${(l.tax_bps / 100).toFixed(2).replace(/\.00$/, "")}%)`;
      taxGroups.set(label, (taxGroups.get(label) || 0) + l.tax_minor);
    }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>Invoice ${escape(s.number)}</title><style>
 *{box-sizing:border-box}body{color:#243044;font:10px/1.55 Arial,Helvetica,sans-serif;margin:0;background:#fff}h1{font-size:32px;letter-spacing:2px;line-height:1.2;margin:0 0 10px;color:${/^#[0-9a-fA-F]{6}$/.test(s.accent) ? s.accent : "#365f9b"}}h2{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#647186;margin:0 0 8px}p{margin:0 0 7px}.top{display:flex;justify-content:space-between;gap:25px;border-bottom:2px solid #dce3ed;padding-bottom:24px;margin-bottom:24px}.issuer{max-width:48%}.issuer strong{font-size:17px;line-height:1.4;display:block;margin-bottom:6px}.heading{text-align:right}.number{font-size:12px;font-weight:bold}.billing{display:flex;justify-content:space-between;gap:24px;margin:0 0 26px}.recipient{max-width:56%}.dates{min-width:190px}.date-row{display:flex;justify-content:space-between;gap:20px;margin-bottom:5px}.muted{color:#647186}.preserve{white-space:pre-wrap;overflow-wrap:anywhere}strong{font-weight:700}.draft{color:#8a5f1c;font-weight:bold}table{border-collapse:collapse;width:100%;table-layout:fixed}thead{display:table-header-group}th{text-align:right;background:#eff3f8;font-size:8px;text-transform:uppercase;letter-spacing:.6px;color:#4b5d76;padding:10px 8px;border-bottom:1px solid #dce3ed}th:first-child{text-align:left;width:43%}th:nth-child(2){width:12%}th:nth-child(3){width:15%}th:nth-child(4){width:14%}th:last-child{width:16%}td{text-align:right;border-bottom:1px solid #e3e7ee;padding:11px 8px;vertical-align:top;font-variant-numeric:tabular-nums}td:first-child{text-align:left;overflow-wrap:anywhere}tr{break-inside:avoid}td small{display:block;font-size:8px;color:#647186;margin-top:4px}.totals{margin:22px 0 26px auto;width:285px;break-inside:avoid}.sum{display:flex;justify-content:space-between;gap:20px;margin:7px 0}.grand{font-size:16px;border-top:1px solid #cdd7e5;padding-top:12px;margin-top:12px;font-weight:bold;color:${/^#[0-9a-fA-F]{6}$/.test(s.accent) ? s.accent : "#365f9b"}}.balance{font-weight:bold}.terms{border-top:1px solid #dce3ed;padding-top:20px;margin-top:20px}.terms section{margin-bottom:18px;break-inside:avoid}.registration{font-size:9px;color:#647186;margin-top:8px}.fine{font-size:8px;color:#647186;margin-top:18px}
 </style></head><body><header class="top"><div class="issuer">${party(s.issuer)}${s.issuer.registration_number ? `<div class="registration">Registration: ${escape(s.issuer.registration_number)}</div>` : ""}</div><div class="heading"><h1>INVOICE</h1><div class="number">${escape(s.number)}</div>${s.number === "DRAFT" ? '<p class="draft">Draft - not issued</p>' : ""}<div class="muted">All amounts in CAD</div></div></header><div class="billing"><section class="recipient"><h2>Bill to</h2>${party(s.client)}</section><section class="dates"><div class="date-row"><span class="muted">Invoice date</span><strong>${escape(s.issue_date)}</strong></div><div class="date-row"><span class="muted">Payment due</span><strong>${escape(s.due_date)}</strong></div><div class="date-row"><span class="muted">Currency</span><strong>CAD</strong></div></section></div>
 <table><thead><tr><th>Description</th><th>Quantity</th><th>Unit rate</th><th>Tax</th><th>Amount</th></tr></thead><tbody>${s.lines.map((l) => `<tr><td>${escape(l.description)}${l.kind === "time" ? `<small>${l.original_seconds} seconds recorded / ${l.billable_seconds} seconds billed</small>` : ""}${l.discount_bps ? `<small>Discount ${(l.discount_bps / 100).toFixed(2)}%: ${money(l.discount_minor)}</small>` : ""}</td><td>${escape(l.kind === "time" ? String((l.billable_seconds || 0) / 60) + " min" : Number(l.quantity).toString())}</td><td>${money(l.unit_minor)}${l.kind === "time" ? "/h" : ""}</td><td>${escape(l.tax_label)}<small>${(l.tax_bps / 100).toFixed(2)}%</small></td><td>${money(l.total_minor)}</td></tr>`).join("")}</tbody></table>
 <section class="totals"><div class="sum"><span>Subtotal</span><span>${money(s.subtotal_minor)}</span></div>${s.discount_minor ? `<div class="sum"><span>Discounts</span><span>-${money(s.discount_minor)}</span></div>` : ""}${[...taxGroups].map(([label, total]) => `<div class="sum"><span>${escape(label)}</span><span>${money(total)}</span></div>`).join("")}<div class="sum grand"><span>Total CAD</span><span>${money(s.total_minor)}</span></div><div class="sum"><span>Amount received at issue</span><span>${money(s.received_minor)}</span></div><div class="sum balance"><span>Balance due at issue</span><span>${money(s.balance_minor)}</span></div></section>
 <div class="terms">${s.payment_instructions ? `<section><h2>Payment instructions</h2><div class="preserve">${escape(s.payment_instructions)}</div></section>` : ""}${s.terms ? `<section><h2>Terms</h2><div class="preserve">${escape(s.terms)}</div></section>` : ""}${s.notes ? `<section><h2>Notes</h2><div class="preserve">${escape(s.notes)}</div></section>` : ""}</div><p class="fine">This document records the invoice as issued. Later payments and corrections are recorded separately.</p></body></html>`;
}
let active = 0;
export async function renderInvoicePDF(
  snapshot: InvoiceSnapshot,
): Promise<Buffer> {
  if (active >= 2)
    throw new HttpError(429, "PDF rendering is busy. Try again shortly.");
  active++;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      timeout: 15000,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      ...(process.env.PDF_CHROMIUM_PATH
        ? { executablePath: process.env.PDF_CHROMIUM_PATH }
        : {}),
    });
    const context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: "block",
    });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.setContent(invoiceHTML(snapshot), {
      waitUntil: "load",
      timeout: 15000,
    });
    return await Promise.race([
      page.pdf({
        format: snapshot.paper,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="font-family:Arial,sans-serif;font-size:8px;color:#647186;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
        margin: { top: "15mm", bottom: "19mm", left: "15mm", right: "15mm" },
      }),
      new Promise<Buffer>((_, reject) => {
        timer = setTimeout(() => reject(new Error("PDF timeout")), 15000);
      }),
    ]);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      503,
      "PDF generation failed. The invoice was not issued. Verify the Chromium installation and retry.",
    );
  } finally {
    if (timer) clearTimeout(timer);
    await browser?.close().catch(() => {});
    active--;
  }
}
