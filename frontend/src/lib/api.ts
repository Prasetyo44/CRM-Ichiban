// Klien REST bertipe yang dipakai semua halaman. Identitas agent dikirim via
// header `x-agent-id` (simulasi login; ganti dengan token JWT di produksi).
import { useCallback } from "react";

export type ApiFn = <T>(path: string, init?: RequestInit) => Promise<T>;

export function useApi(apiBaseUrl: string, agentId: string): ApiFn {
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

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Format Rupiah: angka Decimal dari API datang sebagai string. */
export const formatIDR = (value: string | number): string =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
    Number(value),
  );

export const formatDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";
