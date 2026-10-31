// Panel detail deal (slide-over): ubah stage, timeline aktivitas, tugas, quotation.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { errorMessage, formatDate, formatIDR, type ApiFn } from "../../lib/api";
import type { ActivityType, DealDetail, DealStage } from "../../types/sales";
import QuotationForm from "./QuotationForm";
import { STAGES, STAGE_LABEL } from "./SalesPipelineBoard";

const ACTIVITY_LABEL: Record<ActivityType, string> = {
  CALL: "📞 Telepon",
  MEETING: "🤝 Meeting",
  EMAIL: "✉️ Email",
  WHATSAPP: "💬 WhatsApp",
  VISIT: "📍 Kunjungan",
  NOTE: "📝 Catatan",
};

interface Props {
  api: ApiFn;
  dealId: string;
  onClose: () => void;
  /** Dipanggil setelah perubahan yang memengaruhi papan (stage/nilai). */
  onChanged: () => void;
}

export default function DealDetailPanel({ api, dealId, onClose, onChanged }: Props) {
  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showQuotation, setShowQuotation] = useState(false);

  const load = useCallback(() => {
    api<DealDetail>(`/api/deals/${dealId}`)
      .then(setDeal)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [api, dealId]);
  useEffect(load, [load]);

  /** Jalankan aksi tulis, lalu muat ulang detail & papan; tampilkan error bila gagal. */
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    try {
      setError(null);
      await action();
      load();
      onChanged();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };

  const changeStage = (stage: DealStage): void => {
    // Alasan kalah wajib (divalidasi juga di backend).
    const lostReason = stage === "LOST" ? window.prompt("Alasan deal kalah?")?.trim() : undefined;
    if (stage === "LOST" && !lostReason) return;
    void run(() =>
      api(`/api/deals/${dealId}/stage`, { method: "POST", body: JSON.stringify({ stage, lostReason }) }),
    );
  };

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-slate-200 p-5">
          <div>
            <h2 className="text-lg font-semibold">{deal?.title ?? "Memuat…"}</h2>
            {deal && (
              <p className="text-sm text-slate-500">
                {deal.account?.name ?? deal.contact?.name ?? "—"} · {deal.customerType} ·{" "}
                {deal.productLine?.name ?? "Tanpa lini produk"}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Tutup">
            ✕
          </button>
        </header>

        {error && <p className="bg-rose-50 px-5 py-2 text-sm text-rose-700">{error}</p>}

        {deal && (
          <div className="space-y-6 p-5">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Info label="Nilai" value={formatIDR(deal.amount)} />
              <Info label="Probabilitas" value={`${deal.probability}%`} />
              <Info label="Target closing" value={formatDate(deal.expectedCloseDate)} />
            </div>

            <Section title="Stage">
              <div className="flex flex-wrap gap-2">
                {STAGES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={s === deal.stage}
                    onClick={() => changeStage(s)}
                    className={`rounded-md px-2.5 py-1 text-xs ring-1 ${
                      s === deal.stage
                        ? "bg-indigo-600 text-white ring-indigo-600"
                        : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {STAGE_LABEL[s]}
                  </button>
                ))}
              </div>
              {deal.lostReason && <p className="mt-2 text-sm text-rose-700">Alasan kalah: {deal.lostReason}</p>}
            </Section>

            <Section title="Tugas">
              <ul className="space-y-1">
                {deal.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={t.status === "DONE"}
                      onChange={(e) =>
                        void run(() =>
                          api(`/api/tasks/${t.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ status: e.target.checked ? "DONE" : "OPEN" }),
                          }),
                        )
                      }
                    />
                    <span className={t.status === "DONE" ? "text-slate-400 line-through" : ""}>{t.title}</span>
                    <span className="ml-auto text-xs text-slate-400">{formatDate(t.dueAt)}</span>
                  </li>
                ))}
              </ul>
              <InlineAdd
                placeholder="Tugas baru, mis. Kirim sampel warna"
                withDate
                onAdd={(title, dueAt) =>
                  run(() => api("/api/tasks", { method: "POST", body: JSON.stringify({ title, dueAt, dealId }) }))
                }
              />
            </Section>

            <Section
              title="Quotation"
              action={
                <button type="button" onClick={() => setShowQuotation((v) => !v)} className="text-sm text-indigo-600">
                  {showQuotation ? "Batal" : "+ Buat quotation"}
                </button>
              }
            >
              {showQuotation && (
                <QuotationForm
                  api={api}
                  dealId={dealId}
                  onCreated={() => {
                    setShowQuotation(false);
                    load();
                    onChanged();
                  }}
                />
              )}
              <ul className="divide-y divide-slate-100 text-sm">
                {deal.quotations.map((q) => (
                  <li key={q.id} className="flex items-center justify-between py-2">
                    <span className="font-mono text-xs">{q.number}</span>
                    <span className="rounded bg-slate-100 px-1.5 text-xs">{q.status}</span>
                    <span className="font-medium">{formatIDR(q.total)}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Timeline aktivitas">
              <ActivityForm
                onAdd={(type, subject, notes) =>
                  run(() =>
                    api("/api/activities", { method: "POST", body: JSON.stringify({ type, subject, notes, dealId }) }),
                  )
                }
              />
              <ol className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4">
                {deal.activities.map((a) => (
                  <li key={a.id} className="text-sm">
                    <div className="font-medium">
                      {ACTIVITY_LABEL[a.type]} · {a.subject}
                    </div>
                    {a.notes && <p className="whitespace-pre-wrap text-slate-600">{a.notes}</p>}
                    <div className="text-xs text-slate-400">
                      {a.author.name} · {new Date(a.occurredAt).toLocaleString("id-ID")}
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          </div>
        )}
      </aside>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-600">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function InlineAdd({
  placeholder,
  withDate,
  onAdd,
}: {
  placeholder: string;
  withDate?: boolean;
  onAdd: (text: string, date?: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!text.trim()) return;
    const iso = date ? new Date(date).toISOString() : undefined;
    if (await onAdd(text.trim(), iso)) {
      setText("");
      setDate("");
    }
  };
  return (
    <form onSubmit={submit} className="mt-2 flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      {withDate && (
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      )}
      <button type="submit" className="rounded-md bg-slate-800 px-3 py-1 text-sm text-white">
        Tambah
      </button>
    </form>
  );
}

function ActivityForm({ onAdd }: { onAdd: (type: ActivityType, subject: string, notes?: string) => Promise<boolean> }) {
  const [type, setType] = useState<ActivityType>("CALL");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!subject.trim()) return;
    if (await onAdd(type, subject.trim(), notes.trim() || undefined)) {
      setSubject("");
      setNotes("");
    }
  };
  return (
    <form onSubmit={submit} className="space-y-2 rounded-md bg-slate-50 p-3">
      <div className="flex gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ActivityType)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {(Object.keys(ACTIVITY_LABEL) as ActivityType[]).map((t) => (
            <option key={t} value={t}>
              {ACTIVITY_LABEL[t]}
            </option>
          ))}
        </select>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Ringkasan, mis. Telepon PIC soal jadwal docking"
          className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Catatan (opsional)"
        rows={2}
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <button type="submit" className="rounded-md bg-slate-800 px-3 py-1 text-sm text-white">
        Catat aktivitas
      </button>
    </form>
  );
}
