import { mkdir, writeFile } from "node:fs/promises";
import { renderInvoicePDF } from "../features/billing/pdf";
import { quoteFixture } from "./fixtures/quote";
await mkdir("work/pdfs", { recursive: true });
for (const [paper, multi, name] of [
  ["Letter", false, "quote-letter"],
  ["A4", true, "quote-a4-multipage"],
] as const) {
  await writeFile(
    "work/pdfs/" + name + ".pdf",
    await renderInvoicePDF(quoteFixture(paper, multi)),
  );
  console.log("Generated fictional QA PDF:", name);
}
