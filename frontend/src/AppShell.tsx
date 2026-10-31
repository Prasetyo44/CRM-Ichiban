// Kerangka aplikasi: navigasi antar modul CRM. Setiap modul baru cukup
// ditambahkan ke daftar MODULES (satu sumber untuk menu & routing sederhana).
import { useState, type ReactNode } from "react";
import SalesChatDashboard from "./components/SalesChatDashboard";
import AnalyticsDashboard from "./components/analytics/AnalyticsDashboard";
import Customer360, { type EntityFocus } from "./components/collaboration/Customer360";
import NotificationBell from "./components/collaboration/NotificationBell";
import MarketingCenter from "./components/marketing/MarketingCenter";
import ServiceDesk from "./components/service/ServiceDesk";
import MyTasks from "./components/sales/MyTasks";
import SalesPipelineBoard from "./components/sales/SalesPipelineBoard";
import { useApi, type ApiFn } from "./lib/api";

interface ModuleCtx {
  api: ApiFn;
  apiBaseUrl: string;
  agentId: string;
  focus: EntityFocus | null;
  openEntity: (f: EntityFocus) => void;
}

interface ModuleDef {
  key: string;
  label: string;
  render: (ctx: ModuleCtx) => ReactNode;
}

const MODULES: readonly ModuleDef[] = [
  {
    key: "inbox",
    label: "💬 Inbox Chat",
    render: ({ apiBaseUrl, agentId }) => <SalesChatDashboard apiBaseUrl={apiBaseUrl} agentId={agentId} />,
  },
  { key: "pipeline", label: "📊 Pipeline", render: ({ api }) => <SalesPipelineBoard api={api} /> },
  { key: "tasks", label: "✅ Tugas", render: ({ api }) => <MyTasks api={api} /> },
  { key: "service", label: "🛠️ Service", render: ({ api }) => <ServiceDesk api={api} /> },
  { key: "marketing", label: "📣 Marketing", render: ({ api }) => <MarketingCenter api={api} /> },
  {
    key: "customer360",
    label: "🧭 Customer 360",
    render: ({ api, agentId, focus, openEntity }) => <Customer360 api={api} agentId={agentId} focus={focus} onFocus={openEntity} />,
  },
  { key: "analytics", label: "📈 Analitik", render: ({ api }) => <AnalyticsDashboard api={api} /> },
];

export default function AppShell({ apiBaseUrl, agentId }: { apiBaseUrl: string; agentId: string }) {
  const api = useApi(apiBaseUrl, agentId);
  const [active, setActive] = useState(MODULES[0]?.key ?? "inbox");
  // Entitas yang sedang dibuka di Customer 360 (juga target klik notifikasi).
  const [focus, setFocus] = useState<EntityFocus | null>(null);
  const current = MODULES.find((m) => m.key === active) ?? MODULES[0];

  const openEntity = (f: EntityFocus) => {
    setFocus(f);
    setActive("customer360");
  };

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <nav className="flex items-center gap-1 bg-slate-900 px-4">
        <span className="mr-4 py-2 text-sm font-bold text-white">Ichiban CRM</span>
        {MODULES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setActive(m.key)}
            className={`px-3 py-2 text-sm ${
              m.key === active ? "bg-slate-100 text-slate-900" : "text-slate-300 hover:text-white"
            }`}
          >
            {m.label}
          </button>
        ))}
        <NotificationBell api={api} apiBaseUrl={apiBaseUrl} agentId={agentId} onOpen={openEntity} />
      </nav>
      <main className="min-h-0 flex-1">{current?.render({ api, apiBaseUrl, agentId, focus, openEntity })}</main>
    </div>
  );
}
