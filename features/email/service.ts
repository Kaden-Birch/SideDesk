import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  createHash,
} from "node:crypto";
import nodemailer from "nodemailer";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { pool, transaction } from "@/lib/db";
import { HttpError, requireValue, digest } from "@/lib/auth";
import { invoiceEvent } from "@/features/billing/service";
import { quoteEvent } from "@/features/quotes/service";
const envelopeSchema = z
  .object({
    format: z.literal(1),
    nonce: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
    ciphertext: z.string().max(6000),
    tag: z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
  })
  .strict();
const aad = Buffer.from("SideDesk:SMTP:password:v1:singleton:1");
export function smtpKeyAvailable() {
  return /^[a-fA-F0-9]{64}$/.test(process.env.SMTP_ENCRYPTION_KEY || "");
}
function key() {
  requireValue(
    smtpKeyAvailable(),
    503,
    "Configure a dedicated 64-hex-character SMTP_ENCRYPTION_KEY on the deployment",
  );
  return Buffer.from(process.env.SMTP_ENCRYPTION_KEY!, "hex");
}
export function sealPassword(password: string) {
  const k = key();
  try {
    const nonce = randomBytes(12),
      c = createCipheriv("aes-256-gcm", k, nonce);
    c.setAAD(aad);
    const ciphertext = Buffer.concat([c.update(password, "utf8"), c.final()]);
    return {
      format: 1,
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: c.getAuthTag().toString("base64"),
    };
  } finally {
    k.fill(0);
  }
}
export function openPassword(envelope: unknown) {
  const k = key();
  try {
    const e = envelopeSchema.parse(envelope),
      d = createDecipheriv("aes-256-gcm", k, Buffer.from(e.nonce, "base64"));
    d.setAAD(aad);
    d.setAuthTag(Buffer.from(e.tag, "base64"));
    return Buffer.concat([
      d.update(Buffer.from(e.ciphertext, "base64")),
      d.final(),
    ]).toString("utf8");
  } catch {
    throw new HttpError(
      503,
      "SMTP password cannot be decrypted with the deployment key. Restore the original key or explicitly replace the saved password.",
    );
  } finally {
    k.fill(0);
  }
}
export const smtpInput = z
  .object({
    version: z.number().int().min(0),
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9.:-]+$/),
    port: z.number().int().min(1).max(65535),
    security: z.enum(["tls", "starttls", "plain"]),
    username: z.string().max(256).default(""),
    password: z.string().max(1024).optional(),
    clear_password: z.boolean().default(false),
    from_address: z.email().max(254),
    from_name: z
      .string()
      .max(160)
      .refine((v) => !/[\r\n]/.test(v)),
  })
  .strict()
  .refine(
    (p) => p.security !== "plain" || (!p.username && !p.password),
    "Authenticated SMTP requires verified TLS or STARTTLS",
  );
export async function smtpSettings() {
  const s = (
    await pool().query(
      "SELECT host,port,security,username,from_address,from_name,version,password_envelope IS NOT NULL AS has_password FROM smtp_settings WHERE singleton=1",
    )
  ).rows[0];
  return { ...s, configured: Boolean(s), key_available: smtpKeyAvailable() };
}
export async function saveSMTP(p: z.infer<typeof smtpInput>) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(938422)");
    const old = (
      await db.query("SELECT * FROM smtp_settings WHERE singleton=1 FOR UPDATE")
    ).rows[0];
    requireValue(
      (old?.version || 0) === p.version,
      409,
      "SMTP settings changed; reload first",
    );
    let envelope = p.clear_password ? null : old?.password_envelope || null;
    if (p.password !== undefined)
      envelope = p.password ? sealPassword(p.password) : null;
    if (p.security === "plain") {
      requireValue(
        !p.username,
        400,
        "Plain relay mode cannot transmit credentials",
      );
      envelope = null;
    }
    requireValue(
      !p.username || envelope,
      400,
      "Provide an SMTP password for authentication",
    );
    // Preserved secrets must be readable before accepting a replacement configuration.
    if (envelope) openPassword(envelope);
    await db.query(
      "INSERT INTO smtp_settings(singleton,host,port,security,username,password_envelope,from_address,from_name,version) VALUES(1,$1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT(singleton) DO UPDATE SET host=$1,port=$2,security=$3,username=$4,password_envelope=$5,from_address=$6,from_name=$7,version=smtp_settings.version+1,updated_at=now()",
      [
        p.host,
        p.port,
        p.security,
        p.username,
        envelope,
        p.from_address,
        p.from_name,
      ],
    );
    return { ok: true };
  });
}
async function transport() {
  const s = (
    await pool().query("SELECT * FROM smtp_settings WHERE singleton=1")
  ).rows[0];
  requireValue(s, 400, "Configure SMTP in Settings first");
  const password = s.password_envelope ? openPassword(s.password_envelope) : "";
  const mail = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.security === "tls",
    requireTLS: s.security === "starttls",
    ignoreTLS: s.security === "plain",
    ...(s.username ? { auth: { user: s.username, pass: password } } : {}),
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ...(process.env.SMTP_CA_FILE
        ? { ca: await readFile(process.env.SMTP_CA_FILE) }
        : {}),
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  return { mail, s };
}
export async function verifySMTP() {
  const { mail } = await transport();
  try {
    await mail.verify();
    return {
      ok: true,
      message:
        "SMTP connection and configured authentication accepted. No email was sent.",
    };
  } catch {
    throw new HttpError(
      400,
      "SMTP connection or authentication failed. Verify host, port, TLS mode and credentials.",
    );
  } finally {
    mail.close();
  }
}
export const sendInput = z
  .object({
    recipient: z.email().max(254),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((v) => !/[\r\n]/.test(v)),
    body: z.string().max(6000).default(""),
  })
  .strict();
export async function emailHistory(kind: "invoice" | "quote", id: string) {
  const column = kind === "invoice" ? "invoice_id" : "quote_id";
  return (
    await pool().query(
      `SELECT a.id,a.recipient,a.subject,a.document_sha256,a.message_id,a.created_at,COALESCE(r.outcome,'pending') AS outcome,r.summary,r.created_at AS finished_at FROM email_attempt a LEFT JOIN email_result r ON r.attempt_id=a.id WHERE a.${column}=$1 ORDER BY a.created_at DESC`,
      [id],
    )
  ).rows;
}
export async function sendDocument(
  kind: "invoice" | "quote",
  id: string,
  p: z.infer<typeof sendInput>,
  requestKey: string,
) {
  const hash = digest(JSON.stringify({ kind, id, ...p }));
  // Resolve the immutable bytes first; this never sends a draft preview.
  const doc =
    kind === "invoice"
      ? (
          await pool().query(
            "SELECT state,pdf_bytes,pdf_sha256 FROM invoice WHERE id=$1 AND archived_at IS NULL",
            [id],
          )
        ).rows[0]
      : (
          await pool().query(
            "SELECT state,pdf_bytes,pdf_sha256 FROM quote WHERE id=$1 AND archived_at IS NULL",
            [id],
          )
        ).rows[0];
  requireValue(
    doc &&
      doc.pdf_bytes &&
      (kind === "invoice"
        ? doc.state === "issued"
        : ["published", "sent", "accepted"].includes(doc.state)),
    400,
    "Publish or issue the document before emailing it",
  );
  requireValue(
    createHash("sha256").update(doc.pdf_bytes).digest("hex") === doc.pdf_sha256,
    409,
    "Stored document failed checksum verification",
  );
  const { mail, s } = await transport();
  try {
    const attempt = await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        requestKey,
      ]);
      const prior = (
        await db.query(
          "SELECT id,request_hash FROM email_attempt WHERE request_key=$1",
          [requestKey],
        )
      ).rows[0];
      if (prior) {
        requireValue(
          prior.request_hash === hash,
          409,
          "Request key already used",
        );
        return { id: prior.id, send: false, messageId: "" };
      }
      // Serialize with state changes before recording intent. Network I/O stays outside the transaction.
      const parent = (
        await db.query(
          `SELECT state FROM ${kind === "invoice" ? "invoice" : "quote"} WHERE id=$1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      requireValue(
        parent &&
          (kind === "invoice"
            ? parent.state === "issued"
            : ["published", "sent", "accepted"].includes(parent.state)),
        409,
        "Document state changed",
      );
      const aid = randomUUID(),
        messageId = `<${aid}@sidedesk.local>`;
      await db.query(
        "INSERT INTO email_attempt(id,request_key,request_hash,invoice_id,quote_id,recipient,subject,body,document_sha256,message_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          aid,
          requestKey,
          hash,
          kind === "invoice" ? id : null,
          kind === "quote" ? id : null,
          p.recipient,
          p.subject,
          p.body,
          doc.pdf_sha256,
          messageId,
        ],
      );
      return { id: aid, send: true, messageId };
    });
    if (!attempt.send)
      return {
        id: attempt.id,
        ...(await emailHistory(kind, id)).find((a) => a.id === attempt.id),
      };
    let outcome: "accepted" | "failed" | "unknown" = "unknown",
      summary =
        "SMTP outcome is uncertain. Check the mail server before explicitly retrying.";
    try {
      const result = await mail.sendMail({
        from: { name: s.from_name, address: s.from_address },
        to: { address: p.recipient, name: "" },
        subject: p.subject,
        text: p.body,
        messageId: attempt.messageId,
        attachments: [
          {
            filename: `${kind === "invoice" ? "Invoice" : "Quote"}.pdf`,
            content: Buffer.from(doc.pdf_bytes),
            contentType: "application/pdf",
          },
        ],
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (result.accepted?.length === 1 && !result.rejected?.length) {
        outcome = "accepted";
        summary =
          "SMTP server accepted this message. Inbox delivery is not confirmed.";
      } else {
        outcome = "failed";
        summary = "SMTP server did not accept the recipient.";
      }
    } catch (error) {
      const e = error as {
        code?: string;
        responseCode?: number;
        command?: string;
      };
      if (
        e.code === "EAUTH" ||
        (e.responseCode && e.responseCode >= 400) ||
        ["CONN", "AUTH LOGIN", "AUTH PLAIN", "MAIL FROM", "RCPT TO"].includes(
          e.command || "",
        )
      ) {
        outcome = "failed";
        summary =
          "SMTP connection, authentication or message submission was rejected.";
      }
    }
    await transaction(async (db) => {
      await db.query(
        "INSERT INTO email_result(id,attempt_id,outcome,summary) VALUES($1,$2,$3,$4)",
        [randomUUID(), attempt.id, outcome, summary],
      );
      if (kind === "invoice")
        await invoiceEvent(db, id, "email_" + outcome, summary);
      else {
        const q = (
          await db.query("SELECT state FROM quote WHERE id=$1 FOR UPDATE", [id])
        ).rows[0];
        if (outcome === "accepted" && q?.state === "published")
          await db.query(
            "UPDATE quote SET state='sent',version=version+1,updated_at=now() WHERE id=$1",
            [id],
          );
        await quoteEvent(db, id, "email_" + outcome, summary);
      }
    });
    return { id: attempt.id, outcome, summary };
  } finally {
    mail.close();
  }
}
