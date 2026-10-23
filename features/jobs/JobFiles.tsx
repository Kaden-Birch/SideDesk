"use client";
import { useCallback, useEffect, useState } from "react";
import { request, uploadJobFile } from "@/lib/client";
import { Field } from "@/components/ui";
type Attachment = { id: string; original_name: string; byte_size: number };
export default function JobFiles({
  jobId,
  notify,
  context = "jobs",
}: {
  jobId: string;
  context?: "jobs" | "expenses";
  notify: (s: string) => void;
}) {
  const [files, setFiles] = useState<Attachment[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(
    async () =>
      setFiles(await request<Attachment[]>(`${context}/${jobId}/files`)),
    [jobId, context],
  );
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, [load]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "File operation failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>{context === "jobs" ? "Job files" : "Receipt files"}</h2>
      <p className="muted">
        Private authenticated downloads. Attachments are ordinary files; use the
        encrypted vault for credentials. Maximum 10 MB.
      </p>
      {error && (
        <p className="alert danger" role="alert">
          {error}
        </p>
      )}
      <Field
        label={
          context === "jobs" ? "Upload job file" : "Upload expense receipt"
        }
      >
        <input
          type="file"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void run(async () => {
                if (file.size > 10485760)
                  throw new Error("Files must be no larger than 10 MB");
                await uploadJobFile(jobId, file, context);
                await load();
                notify("Attachment stored privately.");
              });
          }}
        />
      </Field>
      {files.map((f) => (
        <div className="row record-row" key={f.id}>
          <a className="link" href={`/api/${context}/${jobId}/files/${f.id}`}>
            {f.original_name}
          </a>
          <small>{(f.byte_size / 1024).toFixed(1)} KB</small>
          <button
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  "Archive this attachment? Its private file is retained in backups.",
                )
              )
                void run(async () => {
                  await request(`${context}/${jobId}/files/${f.id}`, "DELETE");
                  await load();
                  notify("Attachment archived.");
                });
            }}
          >
            Archive file
          </button>
        </div>
      ))}
      {!files.length && <p className="muted">No attachments yet.</p>}
    </section>
  );
}
