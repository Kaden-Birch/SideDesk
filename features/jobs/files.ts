import { randomUUID, createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, writeFile, unlink, open } from "node:fs/promises";
import path from "node:path";
import { pool, transaction } from "@/lib/db";
import { config } from "@/lib/config";
import { requireValue, HttpError } from "@/lib/auth";
import { json } from "@/lib/http";
import { id } from "@/lib/validation";
const maxBytes = 10485760;
export async function jobFiles(
  req: Request,
  parts: string[],
): Promise<Response | undefined> {
  if (
    parts[0] !== "jobs" ||
    parts[2] !== "files" ||
    ![3, 4].includes(parts.length)
  )
    return;
  const jobId = id.parse(parts[1]),
    method = req.method;
  if (parts.length === 3 && method === "GET")
    return json(
      (
        await pool().query(
          "SELECT id,original_name,byte_size,sha256,created_at FROM job_attachment WHERE job_id=$1 AND archived_at IS NULL ORDER BY created_at DESC",
          [jobId],
        )
      ).rows,
    );
  if (parts.length === 3 && method === "POST") {
    requireValue(
      req.headers.get("content-type") === "application/octet-stream",
      415,
      "Upload a binary file",
    );
    let name: string;
    try {
      name = decodeURIComponent(req.headers.get("x-file-name") || "");
    } catch {
      throw new HttpError(400, "Invalid file name");
    }
    requireValue(
      name.trim().length > 0 && name.length <= 200 && !/[\x00-\x1f]/.test(name),
      400,
      "Use a file name of 1–200 characters",
    );
    const reader = req.body?.getReader();
    requireValue(reader, 400, "Choose a file");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "Files must be no larger than 10 MB");
      }
      chunks.push(r.value);
    }
    requireValue(size > 0, 400, "Empty files cannot be uploaded");
    const bytes = Buffer.concat(chunks),
      storageKey = randomUUID(),
      fileId = randomUUID(),
      root = config().FILE_STORAGE_PATH,
      file = path.join(root, storageKey);
    let written = false;
    try {
      await transaction(async (db) => {
        requireValue(
          (await db.query("SELECT id FROM job WHERE id=$1", [jobId])).rowCount,
          404,
          "Job not found",
        );
        await mkdir(root, { recursive: true, mode: 0o700 });
        await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
        written = true;
        await db.query(
          "INSERT INTO job_attachment(id,job_id,storage_key,original_name,byte_size,sha256) VALUES($1,$2,$3,$4,$5,$6)",
          [
            fileId,
            jobId,
            storageKey,
            name,
            size,
            createHash("sha256").update(bytes).digest("hex"),
          ],
        );
      });
    } catch (e) {
      if (written) await unlink(file).catch(() => {});
      throw e;
    }
    return json({ id: fileId }, 201);
  }
  if (parts.length !== 4) return;
  const fileId = id.parse(parts[3]);
  const attachment = (
    await pool().query(
      "SELECT * FROM job_attachment WHERE id=$1 AND job_id=$2 AND archived_at IS NULL",
      [fileId, jobId],
    )
  ).rows[0];
  requireValue(attachment, 404, "File not found");
  if (method === "DELETE") {
    await transaction((db) =>
      db.query("UPDATE job_attachment SET archived_at=now() WHERE id=$1", [
        fileId,
      ]),
    );
    return json({ ok: true });
  }
  if (method === "GET") {
    const handle = await open(
      path.join(config().FILE_STORAGE_PATH, id.parse(attachment.storage_key)),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      requireValue(
        stat.isFile() &&
          stat.size === attachment.byte_size &&
          stat.size <= maxBytes,
        409,
        "Stored file failed validation",
      );
      const bytes = await handle.readFile();
      requireValue(
        createHash("sha256").update(bytes).digest("hex") === attachment.sha256,
        409,
        "File checksum verification failed",
      );
      const filename = attachment.original_name.replace(
        /[^a-zA-Z0-9._-]/g,
        "_",
      );
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    } finally {
      await handle.close();
    }
  }
}
