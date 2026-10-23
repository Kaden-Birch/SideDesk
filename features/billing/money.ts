export class MoneyError extends Error {}
// Integer rational math. All financial rounding is explicit half-up to CAD cents.
export function divideRound(n: bigint, d: bigint) {
  if (n < 0n || d <= 0n) throw new MoneyError("Invalid money ratio");
  return (n + d / 2n) / d;
}
export function safeMinor(n: bigint) {
  if (n < 0n || n > 100000000000000n)
    throw new MoneyError("Amount exceeds supported limit");
  return Number(n);
}
export function quantityMillis(q: string) {
  const [whole, part = ""] = q.split(".");
  return BigInt(whole) * 1000n + BigInt(part.padEnd(3, "0"));
}
export function roundSeconds(seconds: number, minutes: number) {
  const increment = minutes * 60;
  return Math.ceil(seconds / increment) * increment;
}
export function lineAmounts(base: bigint, discountBps: number, taxBps: number) {
  const discount = divideRound(base * BigInt(discountBps), 10000n),
    net = base - discount,
    tax = divideRound(net * BigInt(taxBps), 10000n);
  return {
    subtotal_minor: safeMinor(base),
    discount_minor: safeMinor(discount),
    tax_minor: safeMinor(tax),
    total_minor: safeMinor(net + tax),
  };
}
export function manualAmounts(
  q: string,
  unit: number,
  discount: number,
  tax: number,
) {
  return lineAmounts(
    divideRound(quantityMillis(q) * BigInt(unit), 1000n),
    discount,
    tax,
  );
}
export function timeAmounts(
  seconds: number,
  rate: number,
  discount: number,
  tax: number,
) {
  return lineAmounts(
    divideRound(BigInt(seconds) * BigInt(rate), 3600n),
    discount,
    tax,
  );
}
export function money(minor: number | string) {
  const cents = BigInt(minor);
  return `${cents < 0n ? "-" : ""}$${(cents < 0n ? -cents : cents) / 100n}.${String((cents < 0n ? -cents : cents) % 100n).padStart(2, "0")}`;
}
export function parseDecimal(value: string, scale = 2) {
  if (!new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(value))
    throw new MoneyError(
      `Use a nonnegative number with at most ${scale} decimal places`,
    );
  const [whole, part = ""] = value.split(".");
  const result = Number(
    BigInt(whole) * 10n ** BigInt(scale) + BigInt(part.padEnd(scale, "0")),
  );
  if (!Number.isSafeInteger(result))
    throw new MoneyError("Amount is too large");
  return result;
}
