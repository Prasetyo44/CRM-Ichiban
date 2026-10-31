// Kerangka aplikasi: navigasi antar modul CRM. Setiap modul baru cukup
// ditambahkan ke daftar MODULES (satu sumber untuk menu & routing sederhana).
import { useState, type ReactNode } from "react";
import SalesChatDashboard from "./components/SalesChatDashboard";
import MyTasks from "./components/sales/MyTasks";
import SalesPipelineBoard from "./components/sales/SalesPipelineBoard";
import { useApi, type ApiFn } from "./lib/api";

interface ModuleDef {
  key: string;
  label: string;
  render: (ctx: { api: ApiFn; apiBaseUrl: string; agentId: string }) => ReactNode;
}

const MODULES: readonly ModuleDef[] = [
  {
    key: "inbox",
    label: "💬 Inbox Chat",
    render: ({ apiBaseUrl, agentId }) => <SalesChatDashboard apiBaseUrl={apiBaseUrl} agentId={agentId} />,
  },
  { key: "pipeline", label: "📊 Pipeline", render: ({ api }) => <SalesPipelineBoard api={api} /> },
  { key: "tasks", label: "✅ Tugas", render: ({ api }) => <MyTasks api={api} /> },
];

export default function AppShell({ apiBaseUrl, agentId }: { apiBaseUrl: string; agentId: string }) {
  const api = useApi(apiBaseUrl, agentId);
  const [active, setActive] = useState(MODULES[0]?.key ?? "inbox");
  const current = MODULES.find((m) => m.key === active) ?? MODULES[0];

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
      </nav>
      <main className="min-h-0 flex-1">{current?.render({ api, apiBaseUrl, agentId })}</main>
    </div>
  );
}
