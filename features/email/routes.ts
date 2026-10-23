import { json, read, requestId } from "@/lib/http";
import { id } from "@/lib/validation";
import * as s from "./service";
export async function emailRoutes(req: Request, path: string[]) {
  const route = path.join("/");
  if (route === "smtp" && req.method === "GET")
    return json(await s.smtpSettings());
  if (route === "smtp" && req.method === "PUT")
    return json(await s.saveSMTP(s.smtpInput.parse(await read(req))));
  if (route === "smtp/test" && req.method === "POST")
    return json(await s.verifySMTP());
  if (
    ["invoices", "quotes"].includes(path[0]) &&
    path.length === 3 &&
    path[2] === "email"
  ) {
    const kind = path[0] === "invoices" ? "invoice" : "quote",
      documentId = id.parse(path[1]);
    if (req.method === "GET")
      return json(await s.emailHistory(kind, documentId));
    if (req.method === "POST")
      return json(
        await s.sendDocument(
          kind,
          documentId,
          s.sendInput.parse(await read(req)),
          requestId(req),
        ),
        201,
      );
  }
}
