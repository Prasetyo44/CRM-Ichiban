// Lonceng notifikasi di navigasi: jumlah belum dibaca, daftar notifikasi,
// dan update real-time lewat Socket.IO (event `notification:new`).
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ApiFn } from "../../lib/api";
import type { ClientToServerEvents, NotificationDTO, ServerToClientEvents } from "../../types/crm";
import type { EntityFocus } from "./Customer360";

interface Props {
  api: ApiFn;
  apiBaseUrl: string;
  agentId: string;
  onOpen: (focus: EntityFocus) => void;
}

const timeAgo = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "baru saja";
  if (min < 60) return `${min} mnt lalu`;
  if (min < 1440) return `${Math.round(min / 60)} jam lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
};

export default function NotificationBell({ api, apiBaseUrl, agentId, onOpen }: Props) {
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<{ unread: number; items: NotificationDTO[] }>("/api/notifications")
      .then((d) => {
        setItems(d.items);
        setUnread(d.unread);
      })
      .catch(() => undefined);
  }, [api]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!agentId) return;
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(apiBaseUrl, { auth: { agentId } });
    socket.on("notification:new", (n) => {
      setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]));
      setUnread((u) => u + 1);
    });
    return () => {
      socket.disconnect();
    };
  }, [apiBaseUrl, agentId]);

  // Tutup panel saat klik di luar.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const markRead = (n: NotificationDTO) => {
    if (n.readAt) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    setUnread((u) => Math.max(0, u - 1));
    void api(`/api/notifications/${n.id}/read`, { method: "POST" }).catch(load);
  };

  const readAll = () => {
    setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
    setUnread(0);
    void api("/api/notifications/read-all", { method: "POST" }).catch(load);
  };

  return (
    <div ref={panelRef} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifikasi, ${unread} belum dibaca`}
        className="relative px-3 py-2 text-slate-300 hover:text-white"
      >
        🔔
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-rose-600 px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-20 mt-1 w-96 overflow-hidden rounded-lg bg-white text-slate-900 shadow-xl ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
            <span className="text-sm font-semibold">Notifikasi</span>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="text-xs text-indigo-700 hover:underline">
                Tandai semua dibaca
              </button>
            )}
          </div>
          <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    markRead(n);
                    if (n.entityType && n.entityId) onOpen({ type: n.entityType, id: n.entityId });
                    setOpen(false);
                  }}
                  className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${n.readAt ? "" : "bg-indigo-50/60"}`}
                >
                  <div className="flex items-start gap-2">
                    <span aria-hidden>{n.type === "MENTION" ? "💬" : "🛠️"}</span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm ${n.readAt ? "" : "font-semibold"}`}>{n.title}</div>
                      {n.body && <div className="truncate text-xs text-slate-500">{n.body}</div>}
                      <div className="mt-0.5 text-[11px] text-slate-400">{timeAgo(n.createdAt)}</div>
                    </div>
                    {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-600" aria-label="Belum dibaca" />}
                  </div>
                </button>
              </li>
            ))}
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">Belum ada notifikasi.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
