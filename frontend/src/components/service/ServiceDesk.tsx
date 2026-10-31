// Service Desk: daftar tiket keluhan dengan indikator SLA, detail percakapan,
// catatan internal, dan perubahan status/prioritas.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { errorMessage, type ApiFn } from "../../lib/api";
import type { SlaState, Ticket, TicketCategory, TicketDetail, TicketPriority, TicketStatus } from "../../types/service";

const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "Baru",
  IN_PROGRESS: "Diproses",
  WAITING_CUSTOMER: "Menunggu Customer",
  RESOLVED: "Selesai",
  CLOSED: "Ditutup",
};

const CATEGORY_LABEL: Record<TicketCategory, string> = {
  PRODUCT_QUALITY: "Kualitas Produk",
  DELIVERY: "Pengiriman",
  TECHNICAL_SUPPORT: "Bantuan Teknis",
  WARRANTY_CLAIM: "Klaim Garansi",
  BILLING: "Tagihan",
  OTHER: "Lainnya",
};

const PRIORITIES: TicketPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

const SLA_STYLE: Record<SlaState, { label: string; cls: string }> = {
  on_track: { label: "Aman", cls: "bg-emerald-100 text-emerald-700" },
  at_risk: { label: "Hampir lewat", cls: "bg-amber-100 text-amber-800" },
  breached: { label: "Lewat SLA", cls: "bg-rose-100 text-rose-700" },
  met: { label: "Tercapai", cls: "bg-slate-100 text-slate-600" },
};

type Filter = "open" | "breached" | "all";
const FILTER_QUERY: Record<Filter, string> = { open: "?open=true", breached: "?sla=breached", all: "" };

function SlaBadge({ label, state }: { label: string; state: SlaState }) {
  const s = SLA_STYLE[state];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] ${s.cls}`}>
      {label}: {s.label}
    </span>
  );
}

export default function ServiceDesk({ api }: { api: ApiFn }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api<Ticket[]>(`/api/tickets${FILTER_QUERY[filter]}`)
      .then(setTickets)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [api, filter]);
  useEffect(reload, [reload]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[24rem_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-1 border-b border-slate-200 p-3">
          {(["open", "breached", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-1 text-xs ring-1 ${
                filter === f ? "bg-slate-800 text-white ring-slate-800" : "ring-slate-300"
              }`}
            >
              {{ open: "Terbuka", breached: "Lewat SLA", all: "Semua" }[f]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            className="ml-auto rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white"
          >
            + Tiket
          </button>
        </div>
        {error && <p className="bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {tickets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(t.id);
                  setShowNew(false);
                }}
                className={`w-full border-b border-slate-100 p-3 text-left ${
                  selectedId === t.id ? "bg-indigo-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex justify-between text-xs text-slate-500">
                  <span className="font-mono">{t.number}</span>
                  <span>{STATUS_LABEL[t.status]}</span>
                </div>
                <div className="mt-0.5 text-sm font-medium">{t.subject}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {t.account?.name ?? t.contact?.name ?? "—"} · {CATEGORY_LABEL[t.category]} · {t.priority}
                </div>
                <div className="mt-1.5 flex gap-1">
                  <SlaBadge label="Respons" state={t.sla.firstResponse} />
                  <SlaBadge label="Selesai" state={t.sla.resolution} />
                </div>
              </button>
            </li>
          ))}
          {tickets.length === 0 && <li className="p-4 text-sm text-slate-400">Tidak ada tiket.</li>}
        </ul>
      </aside>

      <section className="min-h-0 overflow-y-auto">
        {showNew ? (
          <NewTicketForm
            api={api}
            onCreated={(t) => {
              setShowNew(false);
              setSelectedId(t.id);
              reload();
            }}
          />
        ) : selectedId ? (
          <TicketView api={api} ticketId={selectedId} onChanged={reload} />
        ) : (
          <p className="p-8 text-center text-sm text-slate-400">Pilih tiket di kiri.</p>
        )}
      </section>
    </div>
  );
}

function TicketView({ api, ticketId, onChanged }: { api: ApiFn; ticketId: string; onChanged: () => void }) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<TicketDetail>(`/api/tickets/${ticketId}`)
      .then(setTicket)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [api, ticketId]);
  useEffect(load, [load]);

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      setError(null);
      await action();
      load();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const patch = (body: Partial<Pick<Ticket, "status" | "priority">>) =>
    run(() => api(`/api/tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify(body) }));

  const send = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!reply.trim()) return;
    await run(() =>
      api(`/api/tickets/${ticketId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: reply.trim(), isInternal: internal }),
      }),
    );
    setReply("");
  };

  if (!ticket) return <p className="p-8 text-sm text-slate-400">{error ?? "Memuat…"}</p>;

  return (
    <div className="space-y-5 p-6">
      <header>
        <div className="font-mono text-xs text-slate-500">{ticket.number}</div>
        <h2 className="text-lg font-semibold">{ticket.subject}</h2>
        <p className="text-sm text-slate-500">
          {ticket.account?.name ?? ticket.contact?.name ?? "—"} · {CATEGORY_LABEL[ticket.category]}
          {ticket.productLine && ` · ${ticket.productLine.name}`}
          {ticket.batchNumber && ` · Batch ${ticket.batchNumber}`} · PIC {ticket.assignee?.name ?? "belum ada"}
        </p>
        <div className="mt-2 flex gap-1">
          <SlaBadge label="Respons" state={ticket.sla.firstResponse} />
          <SlaBadge label="Selesai" state={ticket.sla.resolution} />
          <span className="text-xs text-slate-400">
            · target selesai {new Date(ticket.resolutionDueAt).toLocaleString("id-ID")}
          </span>
        </div>
      </header>

      {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            disabled={s === ticket.status}
            onClick={() => void patch({ status: s })}
            className={`rounded-md px-2.5 py-1 text-xs ring-1 ${
              s === ticket.status ? "bg-indigo-600 text-white ring-indigo-600" : "ring-slate-300 hover:bg-slate-50"
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
        <select
          value={ticket.priority}
          onChange={(e) => void patch({ priority: e.target.value as TicketPriority })}
          className="ml-auto rounded-md border border-slate-300 px-2 py-1 text-xs"
          aria-label="Prioritas"
        >
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>

      <article className="rounded-lg bg-white p-4 text-sm ring-1 ring-slate-200">
        <p className="whitespace-pre-wrap">{ticket.description}</p>
      </article>

      <ol className="space-y-3">
        {ticket.comments.map((c) => (
          <li
            key={c.id}
            className={`rounded-lg p-3 text-sm ring-1 ${
              c.isInternal ? "bg-yellow-50 ring-yellow-200" : "bg-white ring-slate-200"
            }`}
          >
            <div className="mb-1 text-xs text-slate-500">
              {c.author.name} · {new Date(c.createdAt).toLocaleString("id-ID")}
              {c.isInternal && " · 🔒 Catatan internal"}
            </div>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ol>

      <form onSubmit={send} className="space-y-2">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          placeholder={internal ? "Catatan internal untuk tim…" : "Balasan untuk customer…"}
          className={`w-full rounded-md border px-3 py-2 text-sm ${internal ? "border-yellow-300 bg-yellow-50" : "border-slate-300"}`}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            Catatan internal (tidak dikirim ke customer)
          </label>
          <button type="submit" className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm text-white">
            Kirim
          </button>
        </div>
      </form>
    </div>
  );
}

function NewTicketForm({ api, onCreated }: { api: ApiFn; onCreated: (t: Ticket) => void }) {
  const [form, setForm] = useState({
    subject: "",
    description: "",
    category: "PRODUCT_QUALITY" as TicketCategory,
    priority: "NORMAL" as TicketPriority,
    productLineCode: "",
    batchNumber: "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    try {
      const { productLineCode, batchNumber, ...rest } = form;
      const ticket = await api<Ticket>("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          ...rest,
          ...(productLineCode && { productLineCode }),
          ...(batchNumber && { batchNumber }),
        }),
      });
      onCreated(ticket);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const input = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-3 p-6">
      <h2 className="text-lg font-semibold">Tiket baru</h2>
      <input required placeholder="Judul keluhan" value={form.subject} onChange={(e) => set("subject", e.target.value)} className={input} />
      <textarea
        required
        rows={4}
        placeholder="Deskripsi masalah (kondisi permukaan, cara aplikasi, foto, dll.)"
        value={form.description}
        onChange={(e) => set("description", e.target.value)}
        className={input}
      />
      <div className="grid grid-cols-2 gap-3">
        <select value={form.category} onChange={(e) => set("category", e.target.value as TicketCategory)} className={input}>
          {(Object.keys(CATEGORY_LABEL) as TicketCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select value={form.priority} onChange={(e) => set("priority", e.target.value as TicketPriority)} className={input}>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={form.productLineCode} onChange={(e) => set("productLineCode", e.target.value)} className={input}>
          <option value="">— Lini produk —</option>
          <option value="RETAIL_PAINT">Ichiban Paint Retail</option>
          <option value="INDUSTRIAL_PAINT">Ichiban Paint Industri</option>
          <option value="MARINE_PAINT">Ichiban Marine Paint</option>
          <option value="INK">Ichiban Ink</option>
          <option value="OTHER">Lainnya</option>
        </select>
        <input placeholder="Nomor batch (opsional)" value={form.batchNumber} onChange={(e) => set("batchNumber", e.target.value)} className={input} />
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <button type="submit" className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm text-white">
        Buat tiket
      </button>
    </form>
  );
}
