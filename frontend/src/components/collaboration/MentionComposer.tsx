// Kolom catatan internal dengan @mention. Ketik "@" lalu nama rekan untuk
// memunculkan saran; rekan yang dipilih dikirim sebagai id (bukan ditebak dari
// teks), dan hanya yang namanya masih ada di teks saat dikirim yang dihitung.
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { TeamMember } from "../../types/collaboration";

interface Props {
  team: TeamMember[];
  currentUserId: string;
  disabled?: boolean;
  onSubmit: (body: string, mentionUserIds: string[]) => Promise<void>;
}

/** Cari token "@kata" yang sedang diketik tepat sebelum kursor. */
function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([\p{L}\d]*)$/u.exec(before);
  if (!m) return null;
  return { start: caret - (m[2]?.length ?? 0) - 1, query: (m[2] ?? "").toLowerCase() };
}

export default function MentionComposer({ team, currentUserId, disabled, onSubmit }: Props) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<TeamMember[]>([]);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const mention = activeMentionQuery(text, caret);
  const suggestions = useMemo(
    () =>
      mention
        ? team.filter((t) => t.id !== currentUserId && t.name.toLowerCase().includes(mention.query)).slice(0, 6)
        : [],
    [mention, team, currentUserId],
  );

  const choose = (member: TeamMember) => {
    if (!mention) return;
    const insert = `@${member.name} `;
    const next = text.slice(0, mention.start) + insert + text.slice(caret);
    setText(next);
    setPicked((p) => (p.some((x) => x.id === member.id) ? p : [...p, member]));
    const pos = mention.start + insert.length;
    setCaret(pos);
    setHighlight(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const s = suggestions[highlight];
        if (s) choose(s);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    // Mention yang namanya sudah dihapus dari teks tidak ikut dinotifikasi.
    const ids = picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    setSending(true);
    try {
      await onSubmit(body, ids);
      setText("");
      setPicked([]);
    } finally {
      setSending(false);
    }
  };

  const active = picked.filter((p) => text.includes(`@${p.name}`));

  return (
    <div className="relative rounded-lg bg-amber-50/60 p-3 ring-1 ring-amber-200">
      <textarea
        ref={ref}
        rows={3}
        value={text}
        disabled={disabled}
        placeholder="Tulis catatan internal untuk tim… ketik @ untuk menyebut rekan"
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart);
          setHighlight(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        className="w-full resize-none rounded-md border border-amber-200 bg-white px-3 py-2 text-sm"
      />
      {suggestions.length > 0 && (
        <ul role="listbox" className="absolute left-3 z-10 mt-1 w-64 overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-slate-200">
          {suggestions.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${i === highlight ? "bg-indigo-50" : "hover:bg-slate-50"}`}
              >
                <span>{s.name}</span>
                <span className="text-xs text-slate-400">{s.role === "SALES_AGENT" ? "Sales" : "Manager"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span className="mr-auto text-xs text-slate-500">
          🔒 Hanya terlihat oleh tim.
          {active.length > 0 && ` Akan menotifikasi: ${active.map((a) => a.name).join(", ")}`}
        </span>
        <button
          type="button"
          disabled={!text.trim() || sending || disabled}
          onClick={() => void submit()}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {sending ? "Menyimpan…" : "Simpan catatan"}
        </button>
      </div>
    </div>
  );
}
