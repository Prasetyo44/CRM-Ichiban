// Katalog lini produk aktif, di-cache di memori agar setiap pesan chat tidak
// perlu query ulang. Cache juga menjaga system prompt tetap identik antar
// panggilan (prompt caching Anthropic hanya efektif bila prefix tidak berubah).
import type { CustomerType, ProductLine } from "@prisma/client";
import { prisma } from "../../lib/prisma";

const TTL_MS = 5 * 60_000;
let cache: { lines: ProductLine[]; loadedAt: number } | null = null;

export async function getActiveProductLines(): Promise<ProductLine[]> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.lines;
  const lines = await prisma.productLine.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  cache = { lines, loadedAt: Date.now() };
  return lines;
}

/** Panggil setelah admin mengubah katalog agar prompt & skema AI langsung terbarui. */
export function invalidateProductLineCache(): void {
  cache = null;
}

export const servesSegment = (line: ProductLine, segment: CustomerType): boolean =>
  line.segments.includes(segment);
