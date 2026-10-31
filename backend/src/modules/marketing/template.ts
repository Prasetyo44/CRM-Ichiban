// Template pesan kampanye. Placeholder yang didukung sengaja sedikit dan
// divalidasi saat kampanye disimpan, supaya typo seperti {{nma}} tidak
// terkirim mentah ke ribuan customer.
import type { CampaignChannel } from "@prisma/client";

export const PLACEHOLDERS = ["nama", "perusahaan", "kota"] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

const TOKEN = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

/** Placeholder yang tidak dikenal di dalam template (kosong = valid). */
export function unknownPlaceholders(body: string): string[] {
  const unknown = new Set<string>();
  for (const [, name] of body.matchAll(TOKEN)) {
    if (name && !(PLACEHOLDERS as readonly string[]).includes(name.toLowerCase())) unknown.add(name);
  }
  return [...unknown];
}

/** Kalimat berhenti berlangganan yang selalu ditambahkan (wajib untuk pesan promosi). */
export const OPT_OUT_FOOTER: Record<CampaignChannel, string> = {
  WHATSAPP: "Balas STOP untuk berhenti menerima info promo Ichiban.",
  EMAIL: "Tidak ingin menerima email ini lagi? Balas dengan kata STOP.",
};

export function renderMessage(
  body: string,
  channel: CampaignChannel,
  vars: Partial<Record<Placeholder, string | null | undefined>>,
): string {
  const fallback: Record<Placeholder, string> = { nama: "Bapak/Ibu", perusahaan: "perusahaan Anda", kota: "kota Anda" };
  const text = body.replace(TOKEN, (_m, name: string) => {
    const key = name.toLowerCase() as Placeholder;
    return vars[key]?.trim() || fallback[key];
  });
  return `${text.trim()}\n\n${OPT_OUT_FOOTER[channel]}`;
}
