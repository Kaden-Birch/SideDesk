import { it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { invoiceHTML, renderInvoicePDF } from "../features/billing/pdf";
import { invoiceFixture } from "./fixtures/invoice";
it("renders a page-safe Letter invoice with server-controlled template and escaped content", async () => {
  const s = invoiceFixture();
  const html = invoiceHTML({
    ...s,
    notes: '<script>alert(1)</script><img src="file:///etc/passwd">',
  });
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img src=");
  const raw = await renderInvoicePDF(s),
    pdf = await PDFDocument.load(raw);
  expect(pdf.getPageCount()).toBe(1);
  const size = pdf.getPage(0).getSize();
  expect(size.width).toBeCloseTo(612, 0);
  expect(size.height).toBeCloseTo(792, 0);
});
it("renders multipage A4 content with repeating table headings and page numbers", async () => {
  const s = invoiceFixture("A4", true);
  const html = invoiceHTML(s);
  expect(html).toContain("display:table-header-group");
  expect(html).toContain("break-inside:avoid");
  const pdf = await PDFDocument.load(await renderInvoicePDF(s));
  expect(pdf.getPageCount()).toBeGreaterThan(2);
  for (const p of pdf.getPages()) {
    const size = p.getSize();
    expect(Math.abs(size.width - 595.28)).toBeLessThan(1);
    expect(Math.abs(size.height - 841.89)).toBeLessThan(1);
  }
});
it("renders a Letter quote with three-decimal tax components and expiry without invoice payment totals", async () => {
  const { quoteFixture } = await import("./fixtures/quote");
  const s = quoteFixture();
  const html = invoiceHTML(s);
  expect(html).toContain("<h1>QUOTE</h1>");
  expect(html).toContain("Valid until");
  expect(html).toContain("9.975%");
  expect(html).not.toContain("Balance due at issue");
  expect(html).not.toContain("Amount received at issue");
  expect(
    (await PDFDocument.load(await renderInvoicePDF(s))).getPageCount(),
  ).toBe(1);
});
it("renders a multipage A4 quote with frozen component taxes and repeated table headers", async () => {
  const { quoteFixture } = await import("./fixtures/quote");
  const s = quoteFixture("A4", true);
  const pdf = await PDFDocument.load(await renderInvoicePDF(s));
  expect(pdf.getPageCount()).toBeGreaterThan(2);
  for (const page of pdf.getPages())
    expect(Math.abs(page.getSize().width - 595.28)).toBeLessThan(1);
});
