// Kampanye broadcast: daftar kampanye, form buat/jadwalkan dengan pratinjau
// pesan, dan detail (progres kirim, atribusi deal, daftar penerima).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { errorMessage, formatIDR, type ApiFn } from "../../lib/api";
import type {
  Campaign,
  CampaignChannel,
  CampaignDetail,
  CampaignStatus,
  MarketingOptions,
  RecipientStatus,
  Segment,
} from "../../types/marketing";

const STATUS_STYLE: Record<CampaignStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-slate-100 text-slate-700" },
  SCHEDULED: { label: "🕒 Terjadwal", cls: "bg-sky-100 text-sky-800" },
  SENDING: { label: "⏳ Mengirim", cls: "bg-amber-100 text-amber-800" },
  SENT: { label: "✓ Terkirim", cls: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "✕ Dibatalkan", cls: "bg-rose-100 text-rose-700" },
};

const RECIPIENT_LABEL: Record<RecipientStatus, string> = {
  PENDING: "Antre",
  SENT: "✓ Terkirim",
  FAILED: "⚠ Gagal",
  SKIPPED: "– Dilewati",
};

const CHANNEL_LABEL: Record<CampaignChannel, string> = { WHATSAPP: "WhatsApp", EMAIL: "Email" };

/** Cermin `OPT_OUT_FOOTER` di backend (template.ts) untuk pratinjau. */
const FOOTER: Record<CampaignChannel, string> = {
  WHATSAPP: "Balas STOP untuk berhenti menerima info promo Ichiban.",
  EMAIL: "Tidak ingin menerima email ini lagi? Balas dengan kata STOP.",
};

const SAMPLE_VARS: Record<string, string> = { nama: "Pak Budi", perusahaan: "PT Galangan Samudra", kota: "Batam" };
const renderPreview = (body: string, channel: CampaignChannel) =>
  `${body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (m, k: string) => SAMPLE_VARS[k.toLowerCase()] ?? m).trim()}\n\n${FOOTER[channel]}`;

const formatDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function CampaignsPanel({ api, options }: { api: ApiFn; options: MarketingOptions | null }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api<Campaign[]>("/api/marketing/campaigns")
      .then(setCampaigns)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [api]);
  useEffect(reload, [reload]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[22rem_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-3">
          <button
            type="button"
            onClick={() => setSelectedId("new")}
            className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + Kampanye baru
          </button>
        </div>
        {error && <p className="m-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {campaigns.map((c) => {
            const s = STATUS_STYLE[c.status];
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${selectedId === c.id ? "bg-indigo-50" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${s.cls}`}>{s.label}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {CHANNEL_LABEL[c.channel]} · {c.segment.name}
                  </div>
                  <div className="text-xs text-slate-400 tabular-nums">
                    {c.status === "SCHEDULED"
                      ? `Dijadwalkan ${formatDateTime(c.scheduledAt)}`
                      : c.stats && c.stats.total > 0
                        ? `${c.stats.SENT}/${c.stats.total} terkirim`
                        : `Dibuat ${formatDateTime(c.createdAt)}`}
                  </div>
                </button>
              </li>
            );
          })}
          {campaigns.length === 0 && <li className="p-4 text-sm text-slate-400">Belum ada kampanye.</li>}
        </ul>
      </aside>

      <section className="min-h-0 overflow-y-auto">
        {selectedId === "new" ? (
          <CampaignForm
            api={api}
            options={options}
            onCreated={(c) => {
              reload();
              setSelectedId(c.id);
            }}
          />
        ) : selectedId ? (
          <CampaignView key={selectedId} api={api} campaignId={selectedId} onChanged={reload} />
        ) : (
          <p className="p-6 text-sm text-slate-400">Pilih kampanye atau buat yang baru.</p>
        )}
      </section>
    </div>
  );
}

function CampaignForm({
  api,
  options,
  onCreated,
}: {
  api: ApiFn;
  options: MarketingOptions | null;
  onCreated: (c: Campaign) => void;
}) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<CampaignChannel>("WHATSAPP");
  const [segmentId, setSegmentId] = useState("");
  const [productLineCode, setProductLineCode] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("Halo {{nama}}, ");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Segment[]>("/api/marketing/segments")
      .then((s) => {
        setSegments(s);
        setSegmentId((cur) => cur || s[0]?.id || "");
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [api]);

  const segment = segments.find((s) => s.id === segmentId);
  const preview = useMemo(() => renderPreview(body, channel), [body, channel]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await api<Campaign>("/api/marketing/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name,
          channel,
          segmentId,
          body,
          subject: channel === "EMAIL" ? subject : undefined,
          productLineCode: productLineCode || undefined,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        }),
      });
      onCreated(created);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2";
  return (
    <form onSubmit={submit} className="mx-auto grid max-w-5xl gap-6 p-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Kampanye baru</h2>
        <label className="block text-sm">
          <span className="text-slate-600">Nama kampanye</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="mis. Promo antifouling docking Q4" />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="text-sm">
            <span className="text-slate-600">Channel</span>
            <div className="mt-1 flex gap-1.5">
              {(["WHATSAPP", "EMAIL"] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  aria-pressed={channel === ch}
                  onClick={() => setChannel(ch)}
                  className={`flex-1 rounded-md px-3 py-2 text-sm ring-1 ${channel === ch ? "bg-slate-800 text-white ring-slate-800" : "bg-white ring-slate-300"}`}
                >
                  {CHANNEL_LABEL[ch]}
                </button>
              ))}
            </div>
          </div>
          <label className="text-sm">
            <span className="text-slate-600">Segmen audiens</span>
            <select required value={segmentId} onChange={(e) => setSegmentId(e.target.value)} className={input}>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {segment && (
              <span className="mt-1 block text-xs text-slate-500">
                Akan dikirim ke <b className="tabular-nums">{segment.eligible[channel]}</b> kontak opt-in (dari {segment.matched} kontak cocok)
              </span>
            )}
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-slate-600">Lini produk yang dipromosikan (untuk atribusi deal)</span>
          <select value={productLineCode} onChange={(e) => setProductLineCode(e.target.value)} className={input}>
            <option value="">— Semua lini —</option>
            {options?.productLines.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {channel === "EMAIL" && (
          <label className="block text-sm">
            <span className="text-slate-600">Subjek email</span>
            <input required value={subject} onChange={(e) => setSubject(e.target.value)} className={input} />
          </label>
        )}
        <label className="block text-sm">
          <span className="text-slate-600">Isi pesan</span>
          <textarea required rows={6} value={body} onChange={(e) => setBody(e.target.value)} className={input} />
        </label>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          Sisipkan:
          {options?.placeholders.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setBody((b) => `${b}{{${p}}}`)}
              className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-700 hover:bg-slate-200"
            >
              {`{{${p}}}`}
            </button>
          ))}
        </div>
        <label className="block text-sm">
          <span className="text-slate-600">Jadwal kirim (kosongkan untuk simpan sebagai draft)</span>
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={input} />
        </label>
        {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <button type="submit" disabled={saving || !segmentId} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? "Menyimpan…" : scheduledAt ? "Jadwalkan" : "Simpan draft"}
        </button>
      </div>

      <aside>
        <div className="sticky top-6">
          <div className="mb-2 text-xs font-medium text-slate-500">Pratinjau pesan (contoh data)</div>
          <div className={`rounded-lg p-4 text-sm whitespace-pre-wrap shadow-sm ${channel === "WHATSAPP" ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-white ring-1 ring-slate-200"}`}>
            {channel === "EMAIL" && <div className="mb-2 border-b border-slate-200 pb-2 font-semibold">{subject || "(subjek)"}</div>}
            {preview}
          </div>
          <p className="mt-2 text-xs text-slate-500">Kalimat berhenti berlangganan ditambahkan otomatis di setiap pesan.</p>
        </div>
      </aside>
    </form>
  );
}

function CampaignView({ api, campaignId, onChanged }: { api: ApiFn; campaignId: string; onChanged: () => void }) {
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<CampaignDetail>(`/api/marketing/campaigns/${campaignId}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [api, campaignId]);
  useEffect(load, [load]);

  // Selama mengirim, segarkan progres tiap 2 detik.
  const sending = data?.status === "SENDING";
  useEffect(() => {
    if (!sending) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [sending, load]);
  useEffect(() => {
    if (data?.status === "SENT") onChanged();
  }, [data?.status, onChanged]);

  const act = async (action: "send" | "cancel") => {
    setBusy(true);
    try {
      await api(`/api/marketing/campaigns/${campaignId}/${action}`, { method: "POST" });
      load();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="p-6 text-sm text-slate-400">{error ?? "Memuat…"}</p>;
  const s = data.stats;
  const done = s.SENT + s.FAILED + s.SKIPPED;
  const status = STATUS_STYLE[data.status];

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">{data.name}</h2>
          <p className="text-sm text-slate-500">
            {CHANNEL_LABEL[data.channel]} · Segmen “{data.segment.name}” · {data.productLine?.name ?? "Semua lini"} · oleh {data.createdBy.name}
          </p>
        </div>
        <span className={`rounded px-2 py-1 text-xs ${status.cls}`}>{status.label}</span>
        {(data.status === "DRAFT" || data.status === "SCHEDULED") && (
          <button type="button" disabled={busy} onClick={() => void act("send")} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Kirim sekarang
          </button>
        )}
        {(data.status === "DRAFT" || data.status === "SCHEDULED" || data.status === "SENDING") && (
          <button type="button" disabled={busy} onClick={() => void act("cancel")} className="rounded-md px-3 py-1.5 text-sm text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-50">
            Batalkan
          </button>
        )}
      </div>
      {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {data.status === "SCHEDULED" && <p className="text-sm text-sky-800">Akan dikirim otomatis pada {formatDateTime(data.scheduledAt)}.</p>}

      {s.total > 0 && (
        <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-medium">Progres pengiriman</span>
            <span className="tabular-nums text-slate-500">
              {done}/{s.total} diproses
            </span>
          </div>
          <div className="h-2.5 rounded-r bg-slate-100" title={`${done} dari ${s.total} penerima sudah diproses`}>
            <div className="h-2.5 rounded-r bg-indigo-600 transition-[width]" style={{ width: `${(done / s.total) * 100}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3">
            <Stat label="Terkirim" value={String(s.SENT)} />
            <Stat label="Gagal" value={String(s.FAILED)} warn={s.FAILED > 0} />
            <Stat label="Dilewati" value={String(s.SKIPPED)} />
            <Stat label="Antre" value={String(s.PENDING)} />
          </div>
        </div>
      )}

      {data.stats.SENT > 0 && (
        <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
          <h3 className="text-sm font-semibold">Hasil ke penjualan</h3>
          <p className="mb-3 text-xs text-slate-500">
            Deal {data.productLine ? `${data.productLine.name} ` : ""}yang dibuat penerima dalam {data.attribution.windowDays} hari setelah pesan diterima
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Deal baru" value={String(data.attribution.deals)} />
            <Stat label="Deal menang" value={String(data.attribution.won)} />
            <Stat label="Nilai menang" value={formatIDR(data.attribution.wonValue)} />
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
          <h3 className="mb-2 text-sm font-semibold">Penerima</h3>
          {data.recipients.length === 0 ? (
            <p className="text-sm text-slate-400">Daftar penerima dibuat saat kampanye dikirim.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1.5 font-medium">Kontak</th>
                  <th className="py-1.5 font-medium">Alamat</th>
                  <th className="py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recipients.map((r) => (
                  <tr key={r.id} title={r.error ?? undefined}>
                    <td className="py-1.5">
                      {r.contact.name}
                      {r.contact.account && <span className="text-slate-400"> · {r.contact.account.name}</span>}
                    </td>
                    <td className="py-1.5 font-mono text-xs text-slate-600">{r.address}</td>
                    <td className="py-1.5 text-xs">
                      {RECIPIENT_LABEL[r.status]}
                      {r.error && <span className="block text-slate-400">{r.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <aside>
          <div className="mb-2 text-xs font-medium text-slate-500">Isi pesan</div>
          <div className={`rounded-lg p-4 text-sm whitespace-pre-wrap ${data.channel === "WHATSAPP" ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-white ring-1 ring-slate-200"}`}>
            {data.subject && <div className="mb-2 border-b border-slate-200 pb-2 font-semibold">{data.subject}</div>}
            {renderPreview(data.body, data.channel)}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 flex items-center gap-1 text-lg font-semibold tabular-nums">
        {warn && <span aria-label="Perlu perhatian" className="text-rose-600">⚠</span>}
        {value}
      </div>
    </div>
  );
}
