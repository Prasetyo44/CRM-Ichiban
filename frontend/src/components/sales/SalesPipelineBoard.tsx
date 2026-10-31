// Papan pipeline deal (kanban per stage) + panel detail deal.
// Total per kolom & weighted forecast (nilai × probabilitas) dihitung di klien
// dari daftar deal yang sudah difilter sesuai hak akses oleh backend.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { errorMessage, formatIDR, type ApiFn } from "../../lib/api";
import type { CustomerType } from "../../types/crm";
import type { DealStage, DealSummary } from "../../types/sales";
import DealDetailPanel from "./DealDetailPanel";

export const STAGE_LABEL: Record<DealStage, string> = {
  QUALIFICATION: "Kualifikasi",
  NEEDS_ANALYSIS: "Analisis Kebutuhan",
  PROPOSAL: "Penawaran",
  NEGOTIATION: "Negosiasi",
  WON: "Menang",
  LOST: "Kalah",
};
export const STAGES = Object.keys(STAGE_LABEL) as DealStage[];

const STAGE_ACCENT: Record<DealStage, string> = {
  QUALIFICATION: "border-t-slate-400",
  NEEDS_ANALYSIS: "border-t-sky-500",
  PROPOSAL: "border-t-indigo-500",
  NEGOTIATION: "border-t-amber-500",
  WON: "border-t-emerald-500",
  LOST: "border-t-rose-500",
};

export default function SalesPipelineBoard({ api }: { api: ApiFn }) {
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [segment, setSegment] = useState<CustomerType | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const reload = useCallback(() => {
    api<DealSummary[]>("/api/deals")
      .then(setDeals)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [api]);
  useEffect(reload, [reload]);

  const visible = useMemo(
    () => (segment === "ALL" ? deals : deals.filter((d) => d.customerType === segment)),
    [deals, segment],
  );

  // Ringkasan pipeline: nilai terbuka & forecast berbobot.
  const open = visible.filter((d) => d.stage !== "WON" && d.stage !== "LOST");
  const openValue = open.reduce((s, d) => s + Number(d.amount), 0);
  const forecast = open.reduce((s, d) => s + (Number(d.amount) * d.probability) / 100, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-5 py-3">
        <Stat label="Deal terbuka" value={String(open.length)} />
        <Stat label="Nilai pipeline" value={formatIDR(openValue)} />
        <Stat label="Forecast berbobot" value={formatIDR(forecast)} />
        <div className="ml-auto flex items-center gap-2">
          {(["ALL", "B2B", "B2C"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSegment(s)}
              className={`rounded-md px-3 py-1 text-sm ring-1 ${
                segment === s ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-600 ring-slate-300"
              }`}
            >
              {s === "ALL" ? "Semua" : s}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white"
          >
            + Deal
          </button>
        </div>
      </div>

      {error && <p className="bg-rose-50 px-5 py-2 text-sm text-rose-700">{error}</p>}
      {showNew && (
        <NewDealForm
          api={api}
          onCreated={() => {
            setShowNew(false);
            reload();
          }}
        />
      )}

      <div className="grid min-h-0 flex-1 auto-cols-[16rem] grid-flow-col gap-3 overflow-x-auto p-4">
        {STAGES.map((stage) => {
          const items = visible.filter((d) => d.stage === stage);
          const total = items.reduce((s, d) => s + Number(d.amount), 0);
          return (
            <section
              key={stage}
              className={`flex min-h-0 flex-col rounded-lg border-t-4 bg-slate-50 ring-1 ring-slate-200 ${STAGE_ACCENT[stage]}`}
            >
              <header className="px-3 py-2">
                <div className="flex items-center justify-between text-sm font-semibold">
                  {STAGE_LABEL[stage]}
                  <span className="rounded bg-slate-200 px-1.5 text-xs">{items.length}</span>
                </div>
                <div className="text-xs text-slate-500">{formatIDR(total)}</div>
              </header>
              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {items.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(d.id)}
                      className="w-full rounded-md bg-white p-3 text-left text-sm shadow-sm ring-1 ring-slate-200 hover:ring-indigo-400"
                    >
                      <div className="font-medium">{d.title}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {d.account?.name ?? d.contact?.name ?? "—"} · {d.customerType}
                      </div>
                      <div className="mt-2 flex justify-between text-xs">
                        <span className="font-semibold text-slate-700">{formatIDR(d.amount)}</span>
                        <span className="text-slate-400">{d.probability}%</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {selectedId && (
        <DealDetailPanel api={api} dealId={selectedId} onClose={() => setSelectedId(null)} onChanged={reload} />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function NewDealForm({ api, onCreated }: { api: ApiFn; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [customerType, setCustomerType] = useState<CustomerType>("B2B");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    try {
      await api("/api/deals", {
        method: "POST",
        body: JSON.stringify({ title, customerType, amount: Number(amount) || 0 }),
      });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-indigo-50 px-5 py-3">
      <input
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Judul deal"
        className="w-72 rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <select
        value={customerType}
        onChange={(e) => setCustomerType(e.target.value as CustomerType)}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      >
        <option value="B2B">B2B</option>
        <option value="B2C">B2C</option>
      </select>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="numeric"
        placeholder="Nilai (Rp)"
        className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1 text-sm text-white">
        Simpan
      </button>
      {error && <span className="text-sm text-rose-700">{error}</span>}
    </form>
  );
}
