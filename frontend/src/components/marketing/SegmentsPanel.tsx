// Segmen audiens: daftar segmen + pembuat filter dengan pratinjau jumlah
// audiens secara langsung (total cocok vs. yang boleh dikirimi per channel).
import { useEffect, useState, type FormEvent } from "react";
import { errorMessage, type ApiFn } from "../../lib/api";
import type { CustomerType } from "../../types/crm";
import type { AudiencePreview, CustomerStatusFilter, MarketingOptions, Segment, SegmentFilter } from "../../types/marketing";

const STATUS_LABEL: Record<CustomerStatusFilter, string> = {
  any: "Semua",
  customer: "Sudah pernah beli",
  prospect: "Belum pernah beli",
};

const EMPTY: SegmentFilter = { customerStatus: "any" };

export default function SegmentsPanel({ api, options }: { api: ApiFn; options: MarketingOptions | null }) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selected, setSelected] = useState<Segment | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    api<Segment[]>("/api/marketing/segments")
      .then(setSegments)
      .catch((e: unknown) => setError(errorMessage(e)));
  };
  useEffect(reload, [api]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[22rem_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-3">
          <button
            type="button"
            onClick={() => setSelected("new")}
            className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + Segmen baru
          </button>
        </div>
        {error && <p className="m-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {segments.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSelected(s)}
                className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${selected !== "new" && selected?.id === s.id ? "bg-indigo-50" : ""}`}
              >
                <div className="text-sm font-medium">{s.name}</div>
                <div className="mt-1 text-xs text-slate-500 tabular-nums">
                  {s.matched} kontak · {s.eligible.WHATSAPP} bisa WA · {s.eligible.EMAIL} bisa email
                </div>
                {s._count.campaigns > 0 && <div className="text-xs text-slate-400">Dipakai {s._count.campaigns} kampanye</div>}
              </button>
            </li>
          ))}
          {segments.length === 0 && <li className="p-4 text-sm text-slate-400">Belum ada segmen.</li>}
        </ul>
      </aside>

      <section className="min-h-0 overflow-y-auto">
        {selected ? (
          <SegmentEditor
            key={selected === "new" ? "new" : selected.id}
            api={api}
            options={options}
            segment={selected === "new" ? null : selected}
            onSaved={(s) => {
              reload();
              setSelected(s);
            }}
            onDeleted={() => {
              reload();
              setSelected(null);
            }}
          />
        ) : (
          <p className="p-6 text-sm text-slate-400">Pilih segmen atau buat yang baru.</p>
        )}
      </section>
    </div>
  );
}

function SegmentEditor({
  api,
  options,
  segment,
  onSaved,
  onDeleted,
}: {
  api: ApiFn;
  options: MarketingOptions | null;
  segment: Segment | null;
  onSaved: (s: Segment) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(segment?.name ?? "");
  const [description, setDescription] = useState(segment?.description ?? "");
  const [filter, setFilter] = useState<SegmentFilter>(segment?.filter ?? EMPTY);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Pratinjau audiens diperbarui (debounce 300 ms) setiap filter berubah.
  useEffect(() => {
    const t = setTimeout(() => {
      api<AudiencePreview>("/api/marketing/segments/preview", { method: "POST", body: JSON.stringify({ filter }) })
        .then(setPreview)
        .catch((e: unknown) => setError(errorMessage(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [api, filter]);

  const toggle = (key: "productLineCodes" | "cities" | "businessSectors", value: string) =>
    setFilter((f) => {
      const cur = f[key] ?? [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...f, [key]: next.length ? next : undefined };
    });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({ name, description: description || undefined, filter });
      const saved = segment
        ? await api<Segment>(`/api/marketing/segments/${segment.id}`, { method: "PATCH", body })
        : await api<Segment>("/api/marketing/segments", { method: "POST", body });
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!segment) return;
    try {
      await api(`/api/marketing/segments/${segment.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={save} className="mx-auto max-w-4xl space-y-5 p-6">
      <h2 className="text-lg font-semibold">{segment ? "Ubah segmen" : "Segmen baru"}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          <span className="text-slate-600">Nama segmen</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Keterangan</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
      </div>

      <fieldset className="space-y-4 rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <legend className="px-1 text-sm font-semibold">Filter</legend>
        <FilterRow label="Segmen customer">
          {(["", "B2B", "B2C"] as const).map((t) => (
            <Chip
              key={t || "all"}
              active={(filter.customerType ?? "") === t}
              onClick={() => setFilter((f) => ({ ...f, customerType: (t || undefined) as CustomerType | undefined }))}
            >
              {t === "" ? "Semua" : t === "B2B" ? "B2B (usaha)" : "B2C (perorangan)"}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Status pembelian">
          {(Object.keys(STATUS_LABEL) as CustomerStatusFilter[]).map((s) => (
            <Chip key={s} active={filter.customerStatus === s} onClick={() => setFilter((f) => ({ ...f, customerStatus: s }))}>
              {STATUS_LABEL[s]}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Lini produk (punya deal di)">
          {options?.productLines.map((l) => (
            <Chip key={l.code} active={!!filter.productLineCodes?.includes(l.code)} onClick={() => toggle("productLineCodes", l.code)}>
              {l.name}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Kota">
          {options?.cities.map((c) => (
            <Chip key={c} active={!!filter.cities?.includes(c)} onClick={() => toggle("cities", c)}>
              {c}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Bidang usaha (B2B)">
          {options?.businessSectors.map((s) => (
            <Chip key={s} active={!!filter.businessSectors?.includes(s)} onClick={() => toggle("businessSectors", s)}>
              {s}
            </Chip>
          ))}
        </FilterRow>
      </fieldset>

      <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <h3 className="text-sm font-semibold">Pratinjau audiens</h3>
        {preview ? (
          <>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Stat label="Kontak cocok" value={preview.matched} />
              <Stat label="Bisa dikirimi WhatsApp" value={preview.eligible.WHATSAPP} />
              <Stat label="Bisa dikirimi email" value={preview.eligible.EMAIL} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Broadcast hanya dikirim ke kontak yang sudah memberi persetujuan (opt-in) dan belum berhenti berlangganan.
            </p>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1.5 font-medium">Kontak</th>
                  <th className="py-1.5 font-medium">Perusahaan</th>
                  <th className="py-1.5 font-medium">Kota</th>
                  <th className="py-1.5 font-medium">Persetujuan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.sample.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5">{c.name}</td>
                    <td className="py-1.5 text-slate-600">{c.account?.name ?? "—"}</td>
                    <td className="py-1.5 text-slate-600">{c.city ?? c.account?.city ?? "—"}</td>
                    <td className="py-1.5">
                      {c.unsubscribedAt ? (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">✕ Berhenti</span>
                      ) : c.marketingOptIn ? (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">✓ Opt-in</span>
                      ) : (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">– Belum</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.matched > preview.sample.length && (
              <p className="mt-1 text-xs text-slate-400">Menampilkan {preview.sample.length} dari {preview.matched} kontak.</p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-400">Menghitung…</p>
        )}
      </div>

      {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? "Menyimpan…" : "Simpan segmen"}
        </button>
        {segment && segment._count.campaigns === 0 && (
          <button type="button" onClick={() => void remove()} className="rounded-md px-4 py-2 text-sm text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50">
            Hapus
          </button>
        )}
      </div>
    </form>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-slate-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs ring-1 ${active ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
    >
      {active && "✓ "}
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
