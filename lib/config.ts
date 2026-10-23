import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => !v.includes("REPLACE_")),
  APP_URL: z.url(),
  SESSION_SECRET: z
    .string()
    .min(32)
    .refine((v) => !v.includes("REPLACE_")),
  SETUP_TOKEN: z
    .string()
    .min(32)
    .refine((v) => !v.includes("REPLACE_"))
    .optional(),
  FILE_STORAGE_PATH: z.string().default("/data/uploads"),
  BACKUP_DIR: z.string().default("/data/backups"),
});
export function config() {
  const c = schema.parse(process.env);
  const u = new URL(c.APP_URL);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    u.username ||
    u.password
  )
    throw new Error("Invalid APP_URL");
  return c;
}
