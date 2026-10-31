// Adapter pengiriman broadcast. Versi simulasi hanya mencatat log.
// Produksi: WhatsApp Business API (template message yang sudah di-approve Meta)
// dan penyedia email (SES/SendGrid). Lempar Error bila pengiriman gagal —
// dispatcher akan menandai penerima sebagai FAILED beserta pesan error-nya.
import type { CampaignChannel } from "@prisma/client";

export interface OutboundMessage {
  channel: CampaignChannel;
  address: string;
  subject: string | null;
  text: string;
}

export async function sendMarketingMessage(msg: OutboundMessage): Promise<void> {
  console.info(`[broadcast ${msg.channel} -> ${msg.address}] ${msg.subject ? `${msg.subject} | ` : ""}${msg.text.slice(0, 80)}…`);
}
