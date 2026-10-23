import { randomUUID } from "node:crypto";
import { z } from "zod";
import { json, read, requestId } from "@/lib/http";
import { id, text } from "@/lib/validation";
import { contextFiles } from "@/features/files/routes";
import * as s from "./service";
export async function expenseRoutes(req: Request, path: string[]) {
  if (
    path[0] === "unbilled-charges" &&
    path.length === 1 &&
    req.method === "GET"
  )
    return json(await s.unbilledCharges());
  if (!["expenses", "trips"].includes(path[0])) return;
  if (path[0] === "expenses") {
    const file = await contextFiles(req, path, "expense");
    if (file) return file;
  }
  const context = path[0] === "expenses" ? "expense" : "trip";
  if (path.length === 1 && req.method === "GET")
    return json(await s.costList(context));
  if (path.length === 1 && req.method === "POST") {
    const raw = await read(req);
    const response =
      context === "expense"
        ? await s.saveExpense(
            s.expenseInput.parse({ ...raw, version: undefined }),
            randomUUID(),
            requestId(req),
          )
        : await s.saveTrip(
            s.tripInput.parse({ ...raw, version: undefined }),
            randomUUID(),
            requestId(req),
          );
    return json(response, 201);
  }
  if (path.length !== 2) return;
  const rid = id.parse(path[1]);
  if (req.method === "GET") return json(await s.costDetail(context, rid));
  if (req.method === "PUT") {
    const raw = await read(req);
    z.number().int().positive().parse(raw.version);
    return json(
      context === "expense"
        ? await s.saveExpense(s.expenseInput.parse(raw), rid)
        : await s.saveTrip(s.tripInput.parse(raw), rid),
    );
  }
  if (req.method === "DELETE") {
    const p = z
      .object({ version: z.number().int().positive(), reason: text(1000) })
      .strict()
      .parse(await read(req));
    return json(await s.archiveCost(context, rid, p.version, p.reason));
  }
}
