// Filter segmen audiens marketing. Disimpan sebagai JSON di tabel `segments`,
// divalidasi dengan zod setiap kali dibaca/ditulis, lalu diterjemahkan ke
// `Prisma.ContactWhereInput` sehingga anggota segmen selalu dihitung ulang
// (kontak baru otomatis ikut masuk).
import { CampaignChannel, CustomerType, type Prisma } from "@prisma/client";
import { z } from "zod";

export const SegmentFilter = z
  .object({
    /** B2B = kontak yang terhubung ke Account B2B; B2C = perorangan / Account B2C. */
    customerType: z.enum(CustomerType).optional(),
    /** Kontak yang punya deal di salah satu lini produk ini. */
    productLineCodes: z.array(z.string().min(1).max(64)).max(20).optional(),
    cities: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    /** Bidang usaha Account (khusus B2B), mis. "Galangan kapal". */
    businessSectors: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    /**
     * customer = pernah punya deal WON; prospect = belum pernah WON;
     * any = semua.
     */
    customerStatus: z.enum(["any", "customer", "prospect"]).default("any"),
  })
  .strict();

export type SegmentFilter = z.infer<typeof SegmentFilter>;

/** Ubah daftar string menjadi kondisi `equals` case-insensitive (OR). */
const anyOfInsensitive = (values: string[]) => values.map((v) => ({ equals: v, mode: "insensitive" as const }));

/** Kontak yang cocok dengan filter segmen (tanpa memeriksa consent). */
export function buildContactWhere(filter: SegmentFilter): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [];

  if (filter.customerType === "B2B") and.push({ account: { customerType: "B2B" } });
  if (filter.customerType === "B2C") and.push({ OR: [{ accountId: null }, { account: { customerType: "B2C" } }] });

  if (filter.productLineCodes?.length) {
    and.push({ deals: { some: { productLine: { code: { in: filter.productLineCodes } } } } });
  }
  if (filter.cities?.length) {
    // Kota bisa tercatat di kontak atau di account-nya.
    const cityMatch = anyOfInsensitive(filter.cities);
    and.push({
      OR: [...cityMatch.map((city) => ({ city })), ...cityMatch.map((city) => ({ account: { city } }))],
    });
  }
  if (filter.businessSectors?.length) {
    and.push({ OR: anyOfInsensitive(filter.businessSectors).map((s) => ({ account: { businessSector: s } })) });
  }
  if (filter.customerStatus === "customer") and.push({ deals: { some: { stage: "WON" } } });
  if (filter.customerStatus === "prospect") and.push({ deals: { none: { stage: "WON" } } });

  return and.length ? { AND: and } : {};
}

/**
 * Syarat tambahan agar kontak boleh & bisa menerima broadcast di channel tsb:
 * sudah opt-in, belum berhenti berlangganan, dan punya alamat channel.
 */
export function eligibleWhere(channel: CampaignChannel): Prisma.ContactWhereInput {
  return {
    marketingOptIn: true,
    unsubscribedAt: null,
    ...(channel === "WHATSAPP" ? { phone: { not: null } } : { email: { not: null } }),
  };
}

/**
 * Normalisasi nomor HP Indonesia ke format internasional tanpa "+":
 * "0812-3456 789" / "+62 812 3456789" -> "628123456789".
 * Mengembalikan null bila hasilnya bukan nomor yang masuk akal.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return digits.length >= 9 && digits.length <= 15 ? digits : null;
}

/** Alamat tujuan untuk channel; null bila kontak tidak bisa dihubungi lewat channel itu. */
export function addressFor(
  contact: { phone: string | null; email: string | null },
  channel: CampaignChannel,
): string | null {
  return channel === "WHATSAPP" ? normalizePhone(contact.phone) : (contact.email?.trim().toLowerCase() ?? null);
}
