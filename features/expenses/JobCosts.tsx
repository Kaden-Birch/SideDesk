"use client";
import { useState, useEffect } from "react";
import { request } from "@/lib/client";
import { money } from "@/features/billing/money";
import type { Expense, Trip } from "./service";
export default function JobCosts({
  jobId,
  onNavigate,
}: {
  jobId: string;
  onNavigate: (view: string, id?: string) => void;
}) {
  const [expenses, setExpenses] = useState<Expense[]>([]),
    [trips, setTrips] = useState<Trip[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([request<Expense[]>("expenses"), request<Trip[]>("trips")])
      .then(([e, t]) => {
        setExpenses(e.filter((c) => c.job_id === jobId));
        setTrips(t.filter((c) => c.job_id === jobId));
      })
      .catch((e) => setError(e.message));
  }, [jobId]);
  return (
    <section className="card">
      <h2>Expenses & travel</h2>
      {error && <p role="alert">{error}</p>}
      {expenses.map((e) => (
        <p key={e.id}>
          <button className="link" onClick={() => onNavigate("expenses", e.id)}>
            {e.vendor} · {money(e.amount_minor)} cost ·{" "}
            {money(e.recovery_minor)} customer recovery
          </button>
        </p>
      ))}
      {trips.map((t) => (
        <p key={t.id}>
          <button
            className="link"
            onClick={() => onNavigate("expenses", "trip:" + t.id)}
          >
            {t.purpose} · {t.distance_milli_km / 1000} km
          </button>
        </p>
      ))}
      {!expenses.length && !trips.length && (
        <p className="muted">No expenses or trips linked to this job.</p>
      )}
      <button onClick={() => onNavigate("expenses", "charges")}>
        Review unbilled customer charges
      </button>
    </section>
  );
}
