// Modul Marketing: tab Kampanye broadcast & Segmen audiens.
import { useEffect, useState } from "react";
import { type ApiFn } from "../../lib/api";
import type { MarketingOptions } from "../../types/marketing";
import CampaignsPanel from "./CampaignsPanel";
import SegmentsPanel from "./SegmentsPanel";

type Tab = "campaigns" | "segments";

export default function MarketingCenter({ api }: { api: ApiFn }) {
  const [tab, setTab] = useState<Tab>("campaigns");
  const [options, setOptions] = useState<MarketingOptions | null>(null);

  useEffect(() => {
    api<MarketingOptions>("/api/marketing/options")
      .then(setOptions)
      .catch(() => setOptions(null));
  }, [api]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 border-b border-slate-200 bg-white px-4">
        {(
          [
            ["campaigns", "Kampanye broadcast"],
            ["segments", "Segmen audiens"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`border-b-2 px-3 py-2 text-sm ${tab === key ? "border-indigo-600 font-medium text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "campaigns" ? <CampaignsPanel api={api} options={options} /> : <SegmentsPanel api={api} options={options} />}
      </div>
    </div>
  );
}
