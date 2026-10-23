"use client";
import { useState, useEffect } from "react";
import { request } from "@/lib/client";
import { Field } from "@/components/ui";
import type { TaxComponent } from "./taxes";
export type TaxProfile = {
  id: string;
  name: string;
  components: TaxComponent[];
  version: number;
};
export function useTaxProfiles() {
  const [profiles, setProfiles] = useState<TaxProfile[]>([]);
  useEffect(() => {
    void request<TaxProfile[]>("tax-profiles")
      .then(setProfiles)
      .catch(() => {});
  }, []);
  return profiles;
}
export default function TaxControls({
  prefix,
  profiles,
  components,
  treatment = "taxable",
  onChange,
}: {
  prefix: string;
  profiles: TaxProfile[];
  components?: TaxComponent[];
  treatment?: "taxable" | "zero" | "exempt";
  onChange: (p: {
    tax_components?: TaxComponent[];
    tax_treatment: "taxable" | "zero" | "exempt";
  }) => void;
}) {
  const match = profiles.find(
    (p) => JSON.stringify(p.components) === JSON.stringify(components),
  );
  const selected =
    treatment !== "taxable"
      ? treatment
      : components
        ? match?.id || "snapshot"
        : "manual";
  return (
    <>
      <Field label={`${prefix} tax treatment`}>
        <select
          value={selected}
          onChange={(e) => {
            const p = profiles.find((p) => p.id === e.target.value);
            onChange({
              tax_components: p?.components,
              tax_treatment:
                e.target.value === "zero"
                  ? "zero"
                  : e.target.value === "exempt"
                    ? "exempt"
                    : "taxable",
            });
          }}
        >
          <option value="manual">Manual rate</option>
          <option value="zero">Zero-rated (0%)</option>
          <option value="exempt">Exempt</option>
          {components && !match && (
            <option value="snapshot">Saved tax snapshot</option>
          )}
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      {components && treatment === "taxable" && (
        <p className="muted">
          {components
            .map(
              (c) =>
                `${c.label} ${c.rate_milli_percent / 1000}%${c.compound ? " compounded" : ""}`,
            )
            .join(" + ")}
          . Saved rates stay fixed until you explicitly choose another
          treatment.
        </p>
      )}
    </>
  );
}
export function DocumentTaxPicker({
  profiles,
  onApply,
}: {
  profiles: TaxProfile[];
  onApply: (p: {
    tax_components?: TaxComponent[];
    tax_treatment: "taxable" | "zero" | "exempt";
    tax?: string;
  }) => void;
}) {
  const [selected, setSelected] = useState("");
  return (
    <div className="notice">
      <div className="form-grid">
        <Field label="Document tax treatment">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose a treatment for all lines</option>
            <option value="zero">Zero-rated (0%)</option>
            <option value="exempt">Exempt</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="actions">
          <button
            type="button"
            disabled={!selected}
            onClick={() => {
              const p = profiles.find((p) => p.id === selected);
              onApply({
                tax_components: p?.components,
                tax_treatment:
                  selected === "zero"
                    ? "zero"
                    : selected === "exempt"
                      ? "exempt"
                      : "taxable",
                tax: "0",
              });
            }}
          >
            Apply tax treatment to all draft lines
          </button>
        </div>
      </div>
      <small>
        Applies the selected treatment to each line. Tax rounds per component
        per line; individual lines can be overridden before saving.
      </small>
    </div>
  );
}
