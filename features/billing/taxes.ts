import { z } from "zod";
import { divideRound, safeMinor } from "./money";
export const taxComponents = z
  .array(
    z
      .object({
        label: z.string().trim().min(1).max(60),
        rate_milli_percent: z.number().int().min(0).max(100000),
        compound: z.boolean().default(false),
      })
      .strict(),
  )
  .min(1)
  .max(4);
export type TaxComponent = z.infer<typeof taxComponents>[number];
export type TaxSnapshot = TaxComponent & { amount_minor: number };
export function calculateTaxes(
  net: number,
  components: TaxComponent[],
): TaxSnapshot[] {
  let prior = 0;
  return components.map((c) => {
    const amount_minor = safeMinor(
      divideRound(
        BigInt(net + (c.compound ? prior : 0)) * BigInt(c.rate_milli_percent),
        100000n,
      ),
    );
    prior += amount_minor;
    return { ...c, amount_minor };
  });
}
