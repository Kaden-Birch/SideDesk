import { contextFiles } from "@/features/files/routes";
export const jobFiles = (req: Request, parts: string[]) =>
  contextFiles(req, parts, "job");
