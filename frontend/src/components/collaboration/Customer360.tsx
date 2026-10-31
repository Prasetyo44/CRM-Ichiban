// Customer 360°: cari account/kontak, lalu lihat seluruh riwayatnya dari
// semua modul dalam satu timeline, dan tulis catatan internal dengan @mention.
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage, type ApiFn } from "../../lib/api";
import type { EntityType } from "../../types/crm";
import type { CustomerSearchResult, EntityRef, TeamMember, TimelineEvent, TimelineKind } from "../../types/collaboration";
import MentionComposer from "./MentionComposer";

export interface EntityFocus {
  type: EntityType;
  id: string;
}

const KIND: Record<TimelineKind, { icon: string; label: string }> = {
  chat: { icon: "💬", label: "Chat" },
  deal: { icon: "💼", label: "Deal" },
  activity: { icon: "📞", label: "Aktivitas" },
  task: { icon: "✅", label: "Tugas" },
  quotation: { icon: "📄", label: "Quotation" },
  ticket: { icon: "🛠️", label: "Tiket" },
  ticket_comment: { icon: "🛠️", label: "Tiket" },
  campaign: { icon: "📣", label: "Marketing" },
  note: { icon: "📝", label: "Catatan" },
};

/** Kelompok filter (beberapa jenis event digabung agar chip tidak terlalu banyak). */
const FILTERS: { key: string; label: string; kinds: TimelineKind[] }[] = [
  { key: "all", label: "Semua", kinds: [] },
  { key: "sales", label: "Penjualan", kinds: ["deal", "activity", "task", "quotation"] },
  { key: "chat", label: "Chat", kinds: ["chat"] },
  { key: "service", label: "Service", kinds: ["ticket", "ticket_comment"] },
  { key: "marketing", label: "Marketing", kinds: ["campaign"] },
  { key: "note", label: "Catatan tim", kinds: ["note"] },
];

const TYPE_LABEL: Record<EntityType, string> = { ACCOUNT: "Perusahaan", CONTACT: "Kontak", DEAL: "Deal", TICKET: "Tiket" };

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

interface Props {
  api: ApiFn;
  agentId: string;
  focus: EntityFocus | null;
  onFocus: (f: EntityFocus) => void;
}

export default function Customer360({ api, agentId, focus, onFocus }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CustomerSearchResult | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<CustomerSearchResult>(`/api/customers/search?q=${encodeURIComponent(q)}`)
        .then(setResults)
        .catch(() => setResults(null));
    }, 250);
    return () => clearTimeout(t);
  }, [api, q]);

  const isActive = (type: EntityType, id: string) => focus?.type === type && focus.id === id;

  return (
    <div className="grid h-full min-h-0 grid-cols-[20rem_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari perusahaan, kontak, no. HP…"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ResultGroup title="Perusahaan">
            {results?.accounts.map((a) => (
              <ResultItem
                key={a.id}
                active={isActive("ACCOUNT", a.id)}
                onClick={() => onFocus({ type: "ACCOUNT", id: a.id })}
                title={a.name}
                subtitle={[a.customerType, a.businessSector, a.city].filter(Boolean).join(" · ")}
              />
            ))}
          </ResultGroup>
          <ResultGroup title="Kontak">
            {results?.contacts.map((c) => (
              <ResultItem
                key={c.id}
                active={isActive("CONTACT", c.id)}
                onClick={() => onFocus({ type: "CONTACT", id: c.id })}
                title={c.name}
                subtitle={[c.account?.name, c.city, c.phone].filter(Boolean).join(" · ")}
              />
            ))}
          </ResultGroup>
        </div>
      </aside>

      <section className="min-h-0 overflow-y-auto">
        {focus ? (
          <TimelineView key={`${focus.type}:${focus.id}`} api={api} agentId={agentId} focus={focus} onFocus={onFocus} />
        ) : (
          <p className="p-6 text-sm text-slate-400">Pilih perusahaan atau kontak untuk melihat riwayat lengkapnya.</p>
        )}
      </section>
    </div>
  );
}

function ResultGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-500">{title}</div>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </div>
  );
}

function ResultItem({ title, subtitle, active, onClick }: { title: string; subtitle: string; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={`w-full px-4 py-2.5 text-left hover:bg-slate-50 ${active ? "bg-indigo-50" : ""}`}>
        <div className="truncate text-sm font-medium">{title}</div>
        {subtitle && <div className="truncate text-xs text-slate-500">{subtitle}</div>}
      </button>
    </li>
  );
}

function TimelineView({ api, agentId, focus, onFocus }: { api: ApiFn; agentId: string; focus: EntityFocus; onFocus: (f: EntityFocus) => void }) {
  const [entity, setEntity] = useState<EntityRef | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ entity: EntityRef; events: TimelineEvent[] }>(`/api/timeline/${focus.type}/${focus.id}`)
      .then((d) => {
        setEntity(d.entity);
        setEvents(d.events);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [api, focus]);
  useEffect(load, [load]);
  useEffect(() => {
    api<TeamMember[]>("/api/team").then(setTeam).catch(() => setTeam([]));
  }, [api]);

  const visible = useMemo(() => {
    const kinds = FILTERS.find((f) => f.key === filter)?.kinds ?? [];
    return kinds.length ? events.filter((e) => kinds.includes(e.kind)) : events;
  }, [events, filter]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of FILTERS) m.set(f.key, f.kinds.length ? events.filter((e) => f.kinds.includes(e.kind)).length : events.length);
    return m;
  }, [events]);

  const addNote = async (body: string, mentionUserIds: string[]) => {
    try {
      await api("/api/notes", { method: "POST", body: JSON.stringify({ entityType: focus.type, entityId: focus.id, body, mentionUserIds }) });
      load();
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
  };

  if (!entity) return <p className="p-6 text-sm text-slate-400">{error ?? "Memuat…"}</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header>
        <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{TYPE_LABEL[entity.type]} · Timeline 360°</div>
        <h2 className="text-xl font-semibold">{entity.name}</h2>
        {entity.subtitle && <p className="text-sm text-slate-500">{entity.subtitle}</p>}
      </header>

      <MentionComposer team={team} currentUserId={agentId} onSubmit={addNote} />
      {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs ring-1 ${filter === f.key ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-700 ring-slate-300"}`}
          >
            {f.label} <span className="tabular-nums opacity-70">{counts.get(f.key)}</span>
          </button>
        ))}
      </div>

      <ol className="relative space-y-4 border-l-2 border-slate-200 pl-6">
        {visible.map((e) => {
          const k = KIND[e.kind];
          const isNote = e.kind === "note";
          return (
            <li key={e.id} className="relative">
              <span className="absolute top-0.5 -left-[2.15rem] flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm ring-2 ring-slate-200" aria-hidden>
                {k.icon}
              </span>
              <div className={`rounded-lg p-3 ring-1 ${isNote ? "bg-amber-50/60 ring-amber-200" : "bg-white ring-slate-200"}`}>
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-600">{k.label}</span>
                  <span>{formatDateTime(e.at)}</span>
                  {e.actor && <span>· {e.actor}</span>}
                </div>
                <div className="mt-0.5 text-sm font-medium">{e.title}</div>
                {e.detail && <p className="mt-1 text-sm whitespace-pre-wrap text-slate-600">{e.detail}</p>}
                {e.link && (
                  <button type="button" onClick={() => e.link && onFocus(e.link)} className="mt-1 text-xs text-indigo-700 hover:underline">
                    Buka {TYPE_LABEL[e.link.type].toLowerCase()} →
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {visible.length === 0 && <li className="text-sm text-slate-400">Belum ada riwayat untuk filter ini.</li>}
      </ol>
    </div>
  );
}
