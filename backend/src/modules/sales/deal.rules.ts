// Aturan bisnis pipeline deal (murni, tanpa I/O -> mudah diuji).
import type { DealStage } from "@prisma/client";

/** Urutan tampilan kolom pipeline. */
export const DEAL_STAGES: readonly DealStage[] = [
  "QUALIFICATION",
  "NEEDS_ANALYSIS",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
];

/** Probabilitas default per stage (dipakai untuk weighted forecast di modul analitik). */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  QUALIFICATION: 10,
  NEEDS_ANALYSIS: 25,
  PROPOSAL: 50,
  NEGOTIATION: 75,
  WON: 100,
  LOST: 0,
};

export const isClosedStage = (stage: DealStage): boolean => stage === "WON" || stage === "LOST";

/**
 * Validasi perpindahan stage. Deal terbuka boleh pindah ke stage mana pun
 * (sales sering melompati tahap), tetapi deal yang sudah WON/LOST hanya boleh
 * dibuka ulang ke tahap terbuka secara eksplisit, dan LOST wajib beralasan.
 * Mengembalikan pesan error, atau null bila valid.
 */
export function validateStageChange(from: DealStage, to: DealStage, lostReason?: string | null): string | null {
  if (from === to) return "Deal sudah berada di stage tersebut";
  if (to === "LOST" && !lostReason?.trim()) return "Alasan kalah (lostReason) wajib diisi";
  if (isClosedStage(from) && isClosedStage(to)) return "Deal yang sudah ditutup harus dibuka ulang dulu";
  return null;
}
