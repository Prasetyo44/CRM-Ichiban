// Badge channel asal percakapan (inbox multi-channel). Ikon + teks, bukan warna saja.
import type { Channel } from "../../types/crm";

const CHANNEL: Record<Channel, { icon: string; label: string }> = {
  WHATSAPP: { icon: "🟢", label: "WhatsApp" },
  WEB_CHAT: { icon: "🌐", label: "Web" },
  INSTAGRAM: { icon: "📷", label: "Instagram" },
  FACEBOOK: { icon: "📘", label: "Facebook" },
  EMAIL: { icon: "✉️", label: "Email" },
};

export function ChannelBadge({ channel }: { channel: Channel }) {
  const c = CHANNEL[channel];
  return (
    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600" title={`Channel: ${c.label}`}>
      {c.icon} {c.label}
    </span>
  );
}
