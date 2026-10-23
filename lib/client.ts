"use client";
let csrfToken = "";
export function setCsrf(token: string) {
  csrfToken = token;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const r = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event("sidedesk-expired"));
    throw new ApiError(r.status, data.error || "Request failed");
  }
  return data;
}
export type Settings = {
  name: string;
  timezone: string;
  currency: string;
  hourly_rate_minor: string;
  rounding_minutes: 1 | 5 | 6 | 10 | 15 | 30 | 60;
  invoice_prefix: string;
  tax_enabled: boolean;
  vault_idle_minutes: number;
  https_dismissed: boolean;
  version: number;
};
export type Client = {
  id: string;
  name: string;
  type: "person" | "business";
  email: string;
  phone: string;
  billing_address: string;
  hourly_rate_minor: string | null;
  version: number;
};
export type Activity = {
  id: string;
  client_id: string;
  client_name: string;
  title: string;
  billable: boolean;
  status: "open" | "completed" | "cancelled";
  notes: string;
  duration_seconds: number;
  version: number;
};
export type Timer = {
  id: string;
  activity_id: string;
  title: string;
  client_name: string;
  state: "running" | "paused";
  segment_started_at: string | null;
  accumulated_seconds: number;
  version: number;
};
export type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
};
export type Note = { id: string; body: string; created_at: string };
export type CredentialMeta = {
  id: string;
  title: string;
  client_id: string;
  version: number;
};
export const duration = (s: number) =>
  `${Math.floor(s / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;

export async function requestKey() {
  return (await request<{ id: string }>("request-key")).id;
}
