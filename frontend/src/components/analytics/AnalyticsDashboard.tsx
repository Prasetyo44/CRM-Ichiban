// Dashboard Analitik: KPI penjualan, funnel lead→won, performa per lini produk
// & per sales, serta kesehatan layanan (SLA). Manager melihat data tim; sales
// agent melihat datanya sendiri (cakupan ditentukan backend).
//
// Grafik sengaja sederhana: satu seri per grafik (satu warna, tanpa legenda),
// bar horizontal tipis dengan label langsung, dan tooltip hover di setiap bar.
import { useEffect, useState } from "react";
import { errorMessage, formatIDR, type ApiFn } from "../../lib/api";
import type { AnalyticsOverview } from "../../types/analytics";

type RangeKey = "30" | "90" | "365";
const RANGE_LABEL: Record<RangeKey, string> = { "30": "30 hari", "90": "90 hari", "365": "12 bulan" };

const compactIDR = (v: number): string =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(v);

export default function AnalyticsDashboard({ api }: { api: ApiFn }) {
  const [range, setRange] = useState<RangeKey>("30");
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const from = new Date(Date.now() - Number(range) * 86_400_000).toISOString();
    api<AnalyticsOverview>(`/api/analytics/overview?from=${encodeURIComponent(from)}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [api, range]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        {/* Filter periode: satu baris di atas semua grafik. */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">
            Analitik {data && <span className="text-sm font-normal text-slate-500">· {data.scope === "team" ? "seluruh tim" : "data Anda"}</span>}
          </h2>
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 text-sm ring-1 ${
                range === r ? "bg-slate-800 text-white ring-slate-800" : "bg-white ring-slate-300"
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>

        {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {!data ? (
          !error && <p className="text-sm text-slate-400">Memuat…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Nilai pipeline terbuka" value={formatIDR(data.sales.openPipelineValue)} hint={`${data.sales.openDeals} deal`} />
              <Kpi label="Forecast berbobot" value={formatIDR(data.sales.weightedForecast)} hint="nilai × probabilitas" />
              <Kpi label="Penjualan menang" value={formatIDR(data.sales.wonValue)} hint={`${data.sales.wonCount} deal`} />
              <Kpi
                label="Win rate"
                value={`${data.sales.winRate}%`}
                hint={`rata-rata ${formatIDR(data.sales.avgDealSize)} · siklus ${data.sales.avgSalesCycleDays ?? "—"} hari`}
              />
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <Card title="Funnel lead → deal menang" subtitle="Kohort lead yang masuk pada periode ini">
                <BarList
                  rows={data.funnel.map((f) => ({ label: f.label, value: f.value, display: `${f.value} · ${f.ratePct}%` }))}
                />
              </Card>

              <Card title="Penjualan menang per lini produk" subtitle="Nilai deal WON pada periode ini">
                <BarList
                  rows={data.byProductLine.map((l) => ({
                    label: l.name,
                    value: l.wonValue,
                    display: `${compactIDR(l.wonValue)} · ${l.wonCount} deal · ${l.leads} lead`,
                  }))}
                />
              </Card>
            </div>

            <Card title="Segmen lead" subtitle="Jumlah lead masuk per segmen">
              <div className="grid grid-cols-3 gap-3">
                <Kpi label="B2B (usaha)" value={String(data.bySegment.B2B)} />
                <Kpi label="B2C (perorangan)" value={String(data.bySegment.B2C)} />
                <Kpi label="Belum terkualifikasi" value={String(data.bySegment.unknown)} />
              </div>
            </Card>

            <Card title="Performa sales" subtitle="Pipeline saat ini & hasil pada periode">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="py-2 font-medium">Sales</th>
                      <th className="py-2 text-right font-medium">Deal terbuka</th>
                      <th className="py-2 text-right font-medium">Nilai pipeline</th>
                      <th className="py-2 text-right font-medium">Menang</th>
                      <th className="py-2 text-right font-medium">Nilai menang</th>
                      <th className="py-2 text-right font-medium">Win rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {[...data.bySales]
                      .sort((a, b) => b.wonValue - a.wonValue)
                      .map((s) => (
                        <tr key={s.userId}>
                          <td className="py-2 font-medium">{s.name}</td>
                          <td className="py-2 text-right">{s.openDeals}</td>
                          <td className="py-2 text-right">{formatIDR(s.openPipelineValue)}</td>
                          <td className="py-2 text-right">{s.wonCount}</td>
                          <td className="py-2 text-right">{formatIDR(s.wonValue)}</td>
                          <td className="py-2 text-right">{s.winRate}%</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Layanan (Service)" subtitle="Tiket yang dibuat pada periode ini">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Tiket masuk" value={String(data.service.ticketsCreated)} hint={`${data.service.openTickets} masih terbuka`} />
                <Kpi label="Kepatuhan SLA" value={`${data.service.slaComplianceRate}%`} />
                <Kpi
                  label="Lewat SLA"
                  value={String(data.service.slaBreached)}
                  tone={data.service.slaBreached > 0 ? "critical" : undefined}
                />
                <Kpi label="Rata-rata respons pertama" value={data.service.avgFirstResponseHours === null ? "—" : `${data.service.avgFirstResponseHours} jam`} />
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-white p-5 ring-1 ring-slate-200">
      <h3 className="font-semibold">{title}</h3>
      {subtitle && <p className="mb-4 text-xs text-slate-500">{subtitle}</p>}
      {children}
    </section>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "critical" }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xl font-semibold tabular-nums">
        {/* Status selalu ikon + label, tidak hanya warna. */}
        {tone === "critical" && <span aria-label="Perlu perhatian" className="text-rose-600">⚠</span>}
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

/** Bar horizontal satu seri: label di atas, nilai di kanan, tooltip saat hover. */
function BarList({ rows }: { rows: { label: string; value: number; display: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} className="group" title={`${r.label}: ${r.display}`}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="text-slate-700">{r.label}</span>
            <span className="tabular-nums text-slate-500">{r.display}</span>
          </div>
          <div className="h-2.5 rounded-r bg-slate-100">
            <div
              className="h-2.5 rounded-r bg-indigo-600 transition-[width] group-hover:bg-indigo-700"
              style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? 4 : 0 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
