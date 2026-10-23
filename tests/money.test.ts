import { it, expect } from "vitest";
import {
  manualAmounts,
  timeAmounts,
  parseDecimal,
  roundSeconds,
  money,
} from "../features/billing/money";
it("uses rational half-up arithmetic for fractional quantities, hourly work, discounts and taxes", () => {
  expect(manualAmounts("1.125", 1999, 750, 500)).toEqual({
    subtotal_minor: 2249,
    discount_minor: 169,
    tax_minor: 104,
    total_minor: 2184,
  });
  expect(timeAmounts(1, 1800, 0, 0).total_minor).toBe(1);
  expect(timeAmounts(59, 12345, 0, 500)).toEqual({
    subtotal_minor: 202,
    discount_minor: 0,
    tax_minor: 10,
    total_minor: 212,
  });
});
it("parses currency and percentages without binary floating point", () => {
  expect(parseDecimal("1.15")).toBe(115);
  expect(parseDecimal("7.50")).toBe(750);
  expect(() => parseDecimal("1.005")).toThrow();
  expect(() => parseDecimal("-1")).toThrow();
  expect(() => parseDecimal("1e3")).toThrow();
  expect(money(101)).toBe("$1.01");
});
it("rounds durations explicitly and disabled/zero tax yields no tax", () => {
  expect(roundSeconds(1500, 15)).toBe(1800);
  expect(roundSeconds(900, 15)).toBe(900);
  expect(manualAmounts("2", 1200, 0, 0).tax_minor).toBe(0);
});
