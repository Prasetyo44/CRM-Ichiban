// =============================================================================
// LANGKAH 4 — SalesChatDashboard.tsx
// -----------------------------------------------------------------------------
// Dashboard 3 kolom untuk Sales Spesialis:
//   [Kiri]   Daftar chat yang dialihkan ke sales ini + badge lini produk & segmen.
//   [Tengah] Jendela chat + "AI Summary Box" (kuning transparan) di bagian atas.
//   [Kanan]  Profil Lead (perusahaan untuk B2B / customer untuk B2C) + Status Pipeline.
//
// Sumber data:
//   - REST  : muat awal daftar sesi, histori pesan, kirim balasan, ubah pipeline.
//   - Socket: event real-time `session:assigned`, `message:new`, `lead:updated`.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  CustomerType,
  LeadDTO,
  MessageDTO,
  MessageSender,
  PipelineStage,
  ServerToClientEvents,
  SessionDTO,
} from "../types/crm";

// -----------------------------------------------------------------------------
// Konstanta tampilan (satu sumber untuk label & warna -> minim duplikasi)
// -----------------------------------------------------------------------------

// Warna badge per kode lini produk. Lini baru dari katalog otomatis memakai DEFAULT.
const PRODUCT_LINE_BADGE: Record<string, string> = {
  RETAIL_PAINT: "bg-rose-100 text-rose-800 ring-rose-300",
  INDUSTRIAL_PAINT: "bg-orange-100 text-orange-800 ring-orange-300",
  MARINE_PAINT: "bg-sky-100 text-sky-800 ring-sky-300",
  INK: "bg-violet-100 text-violet-800 ring-violet-300",
};
const DEFAULT_LINE_BADGE = "bg-slate-100 text-slate-700 ring-slate-300";

const SEGMENT_BADGE: Record<CustomerType, string> = {
  B2B: "bg-slate-800 text-white ring-slate-800",
  B2C: "bg-emerald-600 text-white ring-emerald-600",
};

/** Judul lead: nama perusahaan untuk B2B, nama orang untuk B2C. */
const leadTitle = (lead: LeadDTO): string =>
  (lead.customerType === "B2B" ? lead.companyName : lead.contactName) ??
  lead.companyName ??
  lead.contactName ??
  lead.externalId;

const PIPELINE_STAGES: readonly { value: PipelineStage; label: string }[] = [
  { value: "NEW", label: "New" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "PROPOSAL", label: "Proposal" },
  { value: "CLOSED", label: "Closed" },
];

const BUBBLE_STYLE: Record<MessageSender, { row: string; bubble: string; label: string }> = {
  CUSTOMER: { row: "justify-start", bubble: "bg-white text-slate-800 ring-1 ring-slate-200", label: "Customer" },
  AI: { row: "justify-start", bubble: "bg-violet-50 text-violet-900 ring-1 ring-violet-200", label: "AI Agent" },
  AGENT: { row: "justify-end", bubble: "bg-indigo-600 text-white", label: "Anda" },
  SYSTEM: { row: "justify-center", bubble: "bg-slate-200 text-slate-600 text-xs", label: "Sistem" },
};

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

// -----------------------------------------------------------------------------
// Props & helper API
// -----------------------------------------------------------------------------

export interface SalesChatDashboardProps {
  /** Base URL backend, mis. "http://localhost:4000". */
  apiBaseUrl: string;
  /** ID Sales Agent yang sedang login (di produksi: dari token auth). */
  agentId: string;
}

type ConnectionState = "connecting" | "online" | "offline";

/** Wrapper fetch bertipe yang selalu menyertakan identitas agent. */
function useApi(apiBaseUrl: string, agentId: string) {
  return useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", "x-agent-id": agentId, ...init?.headers },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    },
    [apiBaseUrl, agentId],
  );
}

/** Tambahkan pesan tanpa duplikasi (balasan REST & echo socket bisa datang bersamaan). */
const appendUnique = (list: MessageDTO[] = [], message: MessageDTO): MessageDTO[] =>
  list.some((m) => m.id === message.id) ? list : [...list, message];

// -----------------------------------------------------------------------------
// Komponen utama
// -----------------------------------------------------------------------------

export default function SalesChatDashboard({ apiBaseUrl, agentId }: SalesChatDashboardProps) {
  const api = useApi(apiBaseUrl, agentId);

  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, MessageDTO[]>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );
  const activeMessages = activeId ? messagesBySession[activeId] : undefined;

  // --- 1. Muat awal daftar sesi milik agent --------------------------------
  useEffect(() => {
    if (!agentId) return;
    api<SessionDTO[]>("/api/sessions")
      .then((list) => {
        setSessions(list);
        setActiveId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, agentId]);

  // --- 2. Muat histori pesan saat sesi dipilih (sekali per sesi, lalu cache) ---
  useEffect(() => {
    if (!activeId || messagesBySession[activeId]) return;
    api<MessageDTO[]>(`/api/sessions/${activeId}/messages`)
      .then((list) => setMessagesBySession((prev) => ({ ...prev, [activeId]: list })))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, activeId, messagesBySession]);

  // --- 3. Koneksi real-time Socket.IO ---------------------------------------
  useEffect(() => {
    if (!agentId) return;
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(apiBaseUrl, {
      auth: { agentId },
    });

    socket.on("connect", () => setConnection("online"));
    socket.on("disconnect", () => setConnection("offline"));
    socket.on("connect_error", (err) => {
      setConnection("offline");
      setError(`Real-time gagal: ${err.message}`);
    });

    // Lead baru hasil routing AI -> taruh di paling atas daftar.
    socket.on("session:assigned", ({ session, messages }) => {
      setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)]);
      setMessagesBySession((prev) => ({ ...prev, [session.id]: messages }));
      setActiveId((current) => current ?? session.id);
    });

    // Pesan baru -> tambahkan ke histori & naikkan sesi ke atas daftar.
    socket.on("message:new", (message) => {
      setMessagesBySession((prev) =>
        prev[message.sessionId]
          ? { ...prev, [message.sessionId]: appendUnique(prev[message.sessionId], message) }
          : prev, // histori belum dimuat -> akan diambil lengkap via REST saat dibuka
      );
      setSessions((prev) => {
        const target = prev.find((s) => s.id === message.sessionId);
        if (!target) return prev;
        const updated: SessionDTO = { ...target, lastMessage: message, updatedAt: message.createdAt };
        return [updated, ...prev.filter((s) => s.id !== message.sessionId)];
      });
    });

    // Lead diperbarui (mis. dari tab lain) -> sinkronkan semua sesi lead tsb.
    socket.on("lead:updated", (lead) => {
      setSessions((prev) => prev.map((s) => (s.lead.id === lead.id ? { ...s, lead } : s)));
    });

    return () => {
      socket.disconnect();
    };
  }, [apiBaseUrl, agentId]);

  // --- 4. Aksi: kirim balasan ------------------------------------------------
  const sendReply = useCallback(
    async (sessionId: string, content: string): Promise<void> => {
      const message = await api<MessageDTO>(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setMessagesBySession((prev) => ({ ...prev, [sessionId]: appendUnique(prev[sessionId], message) }));
    },
    [api],
  );

  // --- 5. Aksi: ubah pipeline (optimistic update + rollback bila gagal) -------
  const updatePipeline = useCallback(
    async (lead: LeadDTO, stage: PipelineStage): Promise<void> => {
      const applyStage = (value: PipelineStage) =>
        setSessions((prev) =>
          prev.map((s) => (s.lead.id === lead.id ? { ...s, lead: { ...s.lead, pipelineStage: value } } : s)),
        );
      applyStage(stage);
      try {
        await api<LeadDTO>(`/api/leads/${lead.id}/pipeline`, {
          method: "PATCH",
          body: JSON.stringify({ stage }),
        });
      } catch (e) {
        applyStage(lead.pipelineStage);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [api],
  );

  if (!agentId) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 text-slate-600">
        Agent belum login (isi VITE_AGENT_ID).
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <TopBar connection={connection} error={error} onDismissError={() => setError(null)} />
      <div className="grid min-h-0 flex-1 grid-cols-[18rem_1fr_20rem]">
        <SessionList sessions={sessions} activeId={activeId} onSelect={setActiveId} />
        {activeSession ? (
          <ChatWindow
            session={activeSession}
            messages={activeMessages}
            onSend={(text) => sendReply(activeSession.id, text)}
          />
        ) : (
          <EmptyState text="Belum ada chat. Lead baru dari AI akan muncul otomatis di sini." />
        )}
        {activeSession ? (
          <LeadProfilePanel lead={activeSession.lead} onChangeStage={updatePipeline} />
        ) : (
          <aside className="border-l border-slate-200 bg-white" />
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-komponen
// -----------------------------------------------------------------------------

function TopBar({
  connection,
  error,
  onDismissError,
}: {
  connection: ConnectionState;
  error: string | null;
  onDismissError: () => void;
}) {
  const dot = { connecting: "bg-amber-400", online: "bg-emerald-500", offline: "bg-rose-500" }[connection];
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
      <h1 className="text-lg font-semibold">CRM Ichiban · Sales Dashboard</h1>
      <div className="flex items-center gap-4">
        {error && (
          <button
            type="button"
            onClick={onDismissError}
            className="rounded-md bg-rose-50 px-3 py-1 text-sm text-rose-700 ring-1 ring-rose-200"
            title="Klik untuk menutup"
          >
            {error} ✕
          </button>
        )}
        <span className="flex items-center gap-2 text-sm text-slate-500">
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
          {connection === "online" ? "Real-time aktif" : connection === "connecting" ? "Menghubungkan…" : "Offline"}
        </span>
      </div>
    </header>
  );
}

/** Badge [Lini Produk] + [B2B/B2C]. */
function LeadBadges({ lead }: { lead: LeadDTO }) {
  const base = "whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ring-1";
  return (
    <span className="flex shrink-0 items-center gap-1">
      {lead.productLine && (
        <span className={`${base} ${PRODUCT_LINE_BADGE[lead.productLine.code] ?? DEFAULT_LINE_BADGE}`}>
          [{lead.productLine.name.replace(/^Ichiban\s+/, "")}]
        </span>
      )}
      {lead.customerType && <span className={`${base} ${SEGMENT_BADGE[lead.customerType]}`}>{lead.customerType}</span>}
    </span>
  );
}

// ---- Sidebar kiri: daftar chat ------------------------------------------------

function SessionList({
  sessions,
  activeId,
  onSelect,
}: {
  sessions: SessionDTO[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600">
        Chat Masuk ({sessions.length})
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {sessions.map((s) => {
          const active = s.id === activeId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className={`w-full border-b border-slate-100 px-4 py-3 text-left transition ${
                  active ? "bg-indigo-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="truncate font-medium">{leadTitle(s.lead)}</div>
                <div className="mt-1">
                  <LeadBadges lead={s.lead} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="truncate">{s.lastMessage?.content ?? "—"}</span>
                  <span className="shrink-0">{formatTime(s.updatedAt)}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// ---- Kolom tengah: jendela chat ---------------------------------------------------

function ChatWindow({
  session,
  messages,
  onSend,
}: {
  session: SessionDTO;
  messages: MessageDTO[] | undefined;
  onSend: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll ke pesan terbaru.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  // Reset draft saat berpindah sesi.
  useEffect(() => setDraft(""), [session.id]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setDraft("");
    } finally {
      setSending(false);
    }
  };

  const closed = session.status !== "assigned_to_human";

  return (
    <section className="flex min-h-0 flex-col">
      <div className="border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{leadTitle(session.lead)}</h2>
          <LeadBadges lead={session.lead} />
        </div>
        <p className="text-xs text-slate-500">
          {[session.lead.contactName, session.lead.city, session.lead.externalId].filter(Boolean).join(" · ")}
        </p>
      </div>

      {/* AI Summary Box: konteks instan untuk sales sebelum membalas. */}
      <AiSummaryBox lead={session.lead} />

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages === undefined ? (
          <p className="text-center text-sm text-slate-400">Memuat percakapan…</p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-slate-200 bg-white p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={closed}
          placeholder={closed ? "Sesi sudah ditutup" : "Tulis balasan ke customer…"}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:bg-slate-100"
        />
        <button
          type="submit"
          disabled={closed || sending || !draft.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {sending ? "Mengirim…" : "Kirim"}
        </button>
      </form>
    </section>
  );
}

function AiSummaryBox({ lead }: { lead: LeadDTO }) {
  // Baris ringkasan menyesuaikan segmen: B2B fokus perusahaan, B2C fokus orang & lokasi.
  const rows: readonly [string, string | null][] =
    lead.customerType === "B2C"
      ? [
          ["Nama Customer", lead.contactName],
          ["Kota", lead.city],
        ]
      : [
          ["Nama Perusahaan", lead.companyName],
          ["Skala", lead.companyScale],
        ];
  return (
    <div className="mx-5 mt-4 rounded-lg border border-yellow-400/60 bg-yellow-300/25 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-yellow-800">
        <span aria-hidden>✨</span> AI Summary
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <SummaryRow key={label} label={label} value={value} />
        ))}
        <SummaryRow label="Lini Produk" value={lead.productLine?.name ?? null} />
        <dt className="text-yellow-900/70">Kebutuhan</dt>
        <dd className="text-yellow-950">{lead.aiSummary ?? "Belum ada rangkuman dari AI."}</dd>
      </dl>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-yellow-900/70">{label}</dt>
      <dd className="font-medium text-yellow-950">{value ?? "—"}</dd>
    </>
  );
}

function MessageBubble({ message }: { message: MessageDTO }) {
  const style = BUBBLE_STYLE[message.sender];
  return (
    <div className={`flex ${style.row}`}>
      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${style.bubble}`}>
        {message.sender !== "SYSTEM" && (
          <div className="mb-0.5 text-[11px] font-semibold opacity-70">{style.label}</div>
        )}
        <p className="whitespace-pre-wrap">{message.content}</p>
        <div className="mt-1 text-right text-[10px] opacity-60">{formatTime(message.createdAt)}</div>
      </div>
    </div>
  );
}

// ---- Sidebar kanan: profil lead & pipeline -----------------------------------------

function LeadProfilePanel({
  lead,
  onChangeStage,
}: {
  lead: LeadDTO;
  onChangeStage: (lead: LeadDTO, stage: PipelineStage) => Promise<void>;
}) {
  const currentIndex = PIPELINE_STAGES.findIndex((s) => s.value === lead.pipelineStage);

  const isB2C = lead.customerType === "B2C";
  const common: readonly [string, string | null][] = [
    ["Lini Produk", lead.productLine?.name ?? null],
    ["Segmen", lead.customerType],
    ["Kota", lead.city],
    ["Telepon", lead.contactPhone],
    ["Email", lead.contactEmail],
    ["ID Channel", lead.externalId],
  ];
  const fields: readonly [string, string | null][] = isB2C
    ? [["Nama", lead.contactName], ...common]
    : [
        ["Perusahaan", lead.companyName],
        ["Bidang Usaha", lead.businessSector],
        ["Skala", lead.companyScale],
        ["PIC", lead.contactName],
        ...common,
      ];

  return (
    <aside className="flex min-h-0 flex-col gap-6 overflow-y-auto border-l border-slate-200 bg-white p-5">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-600">{isB2C ? "Profil Customer" : "Profil Perusahaan"}</h3>
        <dl className="space-y-2 text-sm">
          {fields.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-slate-500">{label}</dt>
              <dd className="truncate text-right font-medium">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-600">Status Pipeline</h3>
        <ol className="space-y-2">
          {PIPELINE_STAGES.map((stage, index) => {
            const isCurrent = index === currentIndex;
            const isDone = index < currentIndex;
            return (
              <li key={stage.value}>
                <button
                  type="button"
                  disabled={isCurrent}
                  onClick={() => void onChangeStage(lead, stage.value)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ring-1 transition ${
                    isCurrent
                      ? "bg-indigo-600 text-white ring-indigo-600"
                      : isDone
                        ? "bg-indigo-50 text-indigo-800 ring-indigo-200 hover:bg-indigo-100"
                        : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                      isCurrent ? "bg-white text-indigo-600" : isDone ? "bg-indigo-600 text-white" : "bg-slate-200"
                    }`}
                  >
                    {isDone ? "✓" : index + 1}
                  </span>
                  {stage.label}
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </aside>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex items-center justify-center p-8 text-center text-sm text-slate-400">{text}</div>;
}
