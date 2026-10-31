// Perhitungan quotation dengan Decimal (presisi uang, tanpa galat float).
import { Prisma } from "@prisma/client";

const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);
const money = (v: Prisma.Decimal): Prisma.Decimal => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export interface QuotationItemInput {
  productName: string;
  sku?: string | undefined;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPct?: number | undefined;
}

export interface QuotationTotals {
  items: (QuotationItemInput & { lineTotal: Prisma.Decimal; sortOrder: number })[];
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  taxPercent: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
}

/** total = (Σ qty × harga × (1 − disc%)) − diskon nota, lalu + PPN. */
export function calculateQuotation(
  items: QuotationItemInput[],
  discount: number,
  taxPercent: number,
): QuotationTotals {
  const lines = items.map((item, index) => ({
    ...item,
    sortOrder: index,
    lineTotal: money(
      D(item.quantity)
        .mul(item.unitPrice)
        .mul(D(100).minus(item.discountPct ?? 0))
        .div(100),
    ),
  }));
  const subtotal = lines.reduce((sum, l) => sum.plus(l.lineTotal), D(0));
  const disc = money(D(discount));
  if (disc.gt(subtotal)) throw new Error("Diskon melebihi subtotal");
  const taxAmount = money(subtotal.minus(disc).mul(taxPercent).div(100));
  return {
    items: lines,
    subtotal,
    discount: disc,
    taxPercent: D(taxPercent),
    taxAmount,
    total: subtotal.minus(disc).plus(taxAmount),
  };
}
