import { z } from "zod";
import { id, text, rate } from "@/lib/validation";
export const minor = z.number().int().min(0).max(1000000000);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid calendar date");
const lineBase = {
  description: text(500),
  discount_bps: z.number().int().min(0).max(10000).default(0),
  tax_bps: z.number().int().min(0).max(10000).default(0),
  tax_label: z.string().trim().max(60).default("Tax"),
};
export const lineInput = z.discriminatedUnion("kind", [
  z
    .object({
      ...lineBase,
      kind: z.literal("manual"),
      quantity: z
        .string()
        .regex(/^\d{1,6}(\.\d{1,3})?$/)
        .refine((v) => Number(v) > 0),
      unit_minor: minor,
    })
    .strict(),
  z
    .object({
      ...lineBase,
      kind: z.literal("time"),
      source_ids: z.array(id).min(1).max(250),
    })
    .strict(),
]);
export const draftInput = z
  .object({
    client_id: id,
    contact_id: id.nullable().default(null),
    issue_date: date,
    due_date: date,
    paper: z.enum(["A4", "Letter"]).default("Letter"),
    notes: z.string().max(4000).default(""),
    terms: z.string().max(4000).default(""),
    lines: z.array(lineInput).min(1).max(200),
  })
  .strict()
  .refine((v) => v.due_date >= v.issue_date, "Due date must follow issue date");
export type DraftInput = z.infer<typeof draftInput>;
export const jobInput = z
  .object({
    client_id: id,
    title: text(200),
    description: z.string().max(20000).default(""),
    status: z
      .enum([
        "draft",
        "open",
        "in_progress",
        "waiting",
        "completed",
        "cancelled",
      ])
      .default("open"),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    due_date: date.nullable().default(null),
    hourly_rate_minor: rate.nullable().default(null),
  })
  .strict();
export const billingProfile = z
  .object({
    version: z.number().int().positive(),
    legal_name: z.string().max(160),
    address: z.string().max(1000),
    email: z.union([z.literal(""), z.email()]),
    phone: z.string().max(80),
    registration_number: z.string().max(100),
    payment_instructions: z.string().max(2000),
    invoice_terms: z.string().max(4000),
    rounding_scope: z.enum(["entry", "group"]),
    accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict();
export type Party = {
  name: string;
  address: string;
  email: string;
  phone: string;
  registration_number?: string;
  contact?: string;
};
export type Source = {
  id: string;
  activity_id: string;
  client_id: string;
  job_id: string | null;
  title: string;
  job_title: string | null;
  duration_seconds: number;
  rate_minor: string;
  rounding_minutes: number;
  rounding_scope: "entry" | "group";
  billable: boolean;
  rate_source: string;
  version: number;
};
export type Line = {
  id: string;
  kind: "manual" | "time";
  description: string;
  quantity: string;
  unit_minor: number;
  discount_bps: number;
  tax_bps: number;
  tax_label: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  original_seconds: number | null;
  billable_seconds: number | null;
  source_snapshot: Source[];
};
export type InvoiceSnapshot = {
  format: 1;
  number: string;
  issue_date: string;
  due_date: string;
  currency: "CAD";
  paper: "A4" | "Letter";
  issuer: Party;
  client: Party;
  accent: string;
  payment_instructions: string;
  notes: string;
  terms: string;
  lines: Line[];
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  received_minor: number;
  balance_minor: number;
};
export type Invoice = {
  id: string;
  client_id: string;
  client_name: string;
  state: "draft" | "issued" | "void";
  status: string;
  number: string | null;
  issue_date: string;
  due_date: string;
  paper: "A4" | "Letter";
  currency: "CAD";
  issuer_snapshot: Party & { accent: string; payment_instructions: string };
  client_snapshot: Party & { contact_id?: string | null };
  notes: string;
  terms: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  version: number;
  received_minor: number;
  balance_minor: number;
  pdf_sha256: string | null;
  void_reason: string | null;
  lines: Line[];
  payments: Payment[];
  events: { id: string; type: string; summary: string; created_at: string }[];
};
export type Payment = {
  id: string;
  invoice_id: string;
  kind: "receipt" | "reversal";
  amount_minor: string;
  method: string;
  received_on: string;
  reference: string;
  note: string;
  reverses_id: string | null;
  created_at: string;
};
export type Job = {
  id: string;
  client_id: string;
  client_name: string;
  title: string;
  description: string;
  status: z.infer<typeof jobInput>["status"];
  priority: string;
  due_date: string | null;
  hourly_rate_minor: string | null;
  version: number;
  unbilled_seconds: number;
  duration_seconds: number;
  activities?: {
    id: string;
    title: string;
    status: string;
    duration_seconds: number;
  }[];
  notes?: { id: string; body: string; created_at: string }[];
};
