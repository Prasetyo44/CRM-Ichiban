import type { Prisma } from "@prisma/client";

/**
 * Nomor dokumen berurutan & unik, aman untuk request paralel:
 * INSERT ... ON CONFLICT DO UPDATE bersifat atomik di PostgreSQL.
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  prefix: string,
  at = new Date(),
): Promise<string> {
  const period = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, "0")}`;
  const key = `${prefix}-${period}`;
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO counters (key, value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
    RETURNING value`;
  if (!row) throw new Error("Gagal membuat nomor dokumen");
  return `${key}-${String(row.value).padStart(4, "0")}`;
}

