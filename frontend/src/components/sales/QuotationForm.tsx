// Form quotation multi-item. Total di layar hanya PRATINJAU; angka resmi
// dihitung ulang server dengan Decimal (lihat backend quotation.calc.ts).
import { useState, type FormEvent } from "react";
import { errorMessage, formatIDR, type ApiFn } from "../../lib/api";
import type { QuotationItemDraft } from "../../types/sales";

const emptyItem = (): QuotationItemDraft => ({ productName: "", quantity: 1, unit: "pail", unitPrice: 0, discountPct: 0 });

const lineTotal = (i: QuotationItemDraft): number => i.quantity * i.unitPrice * (1 - i.discountPct / 100);

export default function QuotationForm({ api, dealId, onCreated }: { api: ApiFn; dealId: string; onCreated: () => void }) {
  const [items, setItems] = useState<QuotationItemDraft[]>([emptyItem()]);
  const [discount, setDiscount] = useState(0);
  const [taxPercent, setTaxPercent] = useState(11);
  const [validUntil, setValidUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof QuotationItemDraft>(index: number, key: K, value: QuotationItemDraft[K]): void =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)));

  const subtotal = items.reduce((s, i) => s + lineTotal(i), 0);
  const tax = ((subtotal - discount) * taxPercent) / 100;

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/quotations", {
        method: "POST",
        body: JSON.stringify({
          dealId,
          items,
          discount,
          taxPercent,
          ...(validUntil && { validUntil: new Date(validUntil).toISOString() }),
        }),
      });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const num = "w-full rounded border border-slate-300 px-1.5 py-1 text-right text-sm";

  return (
    <form onSubmit={submit} className="mb-3 space-y-2 rounded-md bg-indigo-50 p-3 text-sm">
      <table className="w-full">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="text-left font-normal">Produk</th>
            <th className="w-16 font-normal">Qty</th>
            <th className="w-20 font-normal">Satuan</th>
            <th className="w-28 font-normal">Harga</th>
            <th className="w-14 font-normal">Disc%</th>
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              <td className="pr-1">
                <input
                  required
                  value={item.productName}
                  onChange={(e) => update(i, "productName", e.target.value)}
                  className="w-full rounded border border-slate-300 px-1.5 py-1"
                />
              </td>
              <td className="px-1">
                <input type="number" min={0.001} step="any" value={item.quantity} onChange={(e) => update(i, "quantity", Number(e.target.value))} className={num} />
              </td>
              <td className="px-1">
                <input value={item.unit} onChange={(e) => update(i, "unit", e.target.value)} className="w-full rounded border border-slate-300 px-1.5 py-1" />
              </td>
              <td className="px-1">
                <input type="number" min={0} value={item.unitPrice} onChange={(e) => update(i, "unitPrice", Number(e.target.value))} className={num} />
              </td>
              <td className="px-1">
                <input type="number" min={0} max={100} value={item.discountPct} onChange={(e) => update(i, "discountPct", Number(e.target.value))} className={num} />
              </td>
              <td>
                {items.length > 1 && (
                  <button type="button" onClick={() => setItems((p) => p.filter((_, j) => j !== i))} className="text-rose-500" aria-label="Hapus baris">
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => setItems((p) => [...p, emptyItem()])} className="text-indigo-600">
        + Baris
      </button>

      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-slate-500">
          Diskon nota (Rp)
          <input type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className={num} />
        </label>
        <label className="text-xs text-slate-500">
          PPN %
          <input type="number" min={0} max={100} value={taxPercent} onChange={(e) => setTaxPercent(Number(e.target.value))} className={num} />
        </label>
        <label className="text-xs text-slate-500">
          Berlaku sampai
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="w-full rounded border border-slate-300 px-1.5 py-1 text-sm" />
        </label>
      </div>

      <div className="flex items-center justify-between border-t border-indigo-200 pt-2">
        <span className="text-xs text-slate-500">
          Subtotal {formatIDR(subtotal)} · PPN {formatIDR(tax)}
        </span>
        <span className="font-semibold">Total ± {formatIDR(subtotal - discount + tax)}</span>
      </div>
      {error && <p className="text-rose-700">{error}</p>}
      <button type="submit" disabled={saving} className="rounded-md bg-indigo-600 px-3 py-1 text-white disabled:opacity-50">
        {saving ? "Menyimpan…" : "Simpan quotation"}
      </button>
    </form>
  );
}
