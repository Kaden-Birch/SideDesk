import { mkdir, writeFile } from "node:fs/promises";
import { renderInvoicePDF } from "../features/billing/pdf";
import { invoiceFixture } from "./fixtures/invoice";
await mkdir("work/pdfs", { recursive: true });
for (const [paper, multi, name] of [
  ["Letter", false, "invoice-letter"],
  ["A4", true, "invoice-a4-multipage"],
] as const) {
  const pdf = await renderInvoicePDF(invoiceFixture(paper, multi));
  await writeFile("work/pdfs/" + name + ".pdf", pdf);
  console.log("Generated fictional QA PDF:", name);
}
