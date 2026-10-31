// Skema output JSON AI Agent. Dipakai dua kali:
//  1) sebagai `output_config.format` (structured outputs) -> Claude DIPAKSA
//     menghasilkan JSON dengan field & tipe sesuai skema ini;
//  2) sebagai tipe TypeScript hasil parse -> fully-typed di backend.
//
// CATATAN: helper `betaZodOutputFormat` mengubah `z.enum` menjadi string biasa
// (daftar nilai hanya ditulis di description), sehingga nilai enum TIDAK dijamin
// oleh API. Karena itu `customer_type` & `product_line` sengaja dibuat string
// longgar, lalu dinormalisasi di server (normalizeQualification): nilai di luar
// daftar diubah menjadi null alih-alih membuat seluruh balasan gagal diparse.
import type { ProductLine } from "@prisma/client";
import { z } from "zod";

export const CUSTOMER_TYPES = ["B2B", "B2C"] as const;
export type CustomerTypeValue = (typeof CUSTOMER_TYPES)[number];

export function buildQualificationSchema(productLineCodes: readonly string[]) {
  return z.object({
    qualification_complete: z.boolean(),
    customer_type: z.string().nullable().describe('Salah satu: "B2B" atau "B2C"; null bila belum jelas.'),
    product_line: z
      .string()
      .nullable()
      .describe(`Salah satu kode katalog: ${productLineCodes.join(", ")}; null bila belum jelas.`),
    // Nama orang yang chat (B2C: wajib; B2B: PIC, opsional).
    customer_name: z.string().nullable(),
    city: z.string().nullable(),
    // Khusus B2B:
    company_name: z.string().nullable(),
    company_scale: z.string().nullable(),
    business_sector: z.string().nullable(),
    summary: z.string().nullable(),
    ai_reply_message: z.string(),
  });
}

/** Output mentah dari Claude (sebelum normalisasi). */
export type RawQualification = z.infer<ReturnType<typeof buildQualificationSchema>>;

/** Hasil kualifikasi setelah normalisasi: segmen bertipe literal, lini produk pasti ada di katalog. */
export type QualificationResult = Omit<RawQualification, "customer_type"> & {
  customer_type: CustomerTypeValue | null;
};

export const isCustomerType = (value: string): value is CustomerTypeValue =>
  (CUSTOMER_TYPES as readonly string[]).includes(value);

/** Buang nilai di luar daftar yang sah (toleran huruf besar/kecil). */
export function normalizeQualification(raw: RawQualification, catalog: ProductLine[]): QualificationResult {
  const segment = raw.customer_type?.trim().toUpperCase() ?? "";
  const code = raw.product_line?.trim().toUpperCase() ?? "";
  return {
    ...raw,
    customer_type: isCustomerType(segment) ? segment : null,
    product_line: catalog.some((l) => l.code === code) ? code : null,
  };
}
