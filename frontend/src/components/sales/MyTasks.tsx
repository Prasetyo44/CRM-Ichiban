// Daftar tugas milik sales yang login (manager: semua tugas tim), terlambat ditandai merah.
import { useCallback, useEffect, useState } from "react";
import { errorMessage, formatDate, type ApiFn } from "../../lib/api";
import type { Task, TaskPriority } from "../../types/sales";

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  HIGH: "bg-rose-100 text-rose-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
};

export default function MyTasks({ api }: { api: ApiFn }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Task[]>("/api/tasks?status=OPEN")
      .then(setTasks)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [api]);
  useEffect(load, [load]);

  const complete = async (taskId: string): Promise<void> => {
    try {
      await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "DONE" }) });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const now = Date.now();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="mb-4 text-lg font-semibold">Tugas Saya ({tasks.length})</h2>
      {error && <p className="mb-3 text-sm text-rose-700">{error}</p>}
      <ul className="divide-y divide-slate-200 rounded-lg bg-white ring-1 ring-slate-200">
        {tasks.length === 0 && <li className="p-4 text-sm text-slate-400">Tidak ada tugas terbuka.</li>}
        {tasks.map((t) => {
          const overdue = t.dueAt !== null && new Date(t.dueAt).getTime() < now;
          return (
            <li key={t.id} className="flex items-center gap-3 p-3 text-sm">
              <input type="checkbox" onChange={() => void complete(t.id)} aria-label={`Selesaikan ${t.title}`} />
              <div className="flex-1">
                <div className="font-medium">{t.title}</div>
                {t.deal && <div className="text-xs text-slate-500">{t.deal.title}</div>}
              </div>
              <span className={`rounded px-1.5 py-0.5 text-xs ${PRIORITY_STYLE[t.priority]}`}>{t.priority}</span>
              <span className={`w-28 text-right text-xs ${overdue ? "font-semibold text-rose-600" : "text-slate-500"}`}>
                {overdue ? "Terlambat · " : ""}
                {formatDate(t.dueAt)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
