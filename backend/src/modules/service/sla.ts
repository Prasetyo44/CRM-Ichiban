// Kebijakan SLA tiket (murni, tanpa I/O). Ubah angka di sini sesuai komitmen layanan.
import type { Ticket, TicketPriority } from "@prisma/client";

const HOUR = 60 * 60 * 1000;

/** Target jam: respons pertama & penyelesaian per prioritas. */
export const SLA_POLICY: Record<TicketPriority, { firstResponseHours: number; resolutionHours: number }> = {
  URGENT: { firstResponseHours: 1, resolutionHours: 8 },
  HIGH: { firstResponseHours: 4, resolutionHours: 24 },
  NORMAL: { firstResponseHours: 8, resolutionHours: 72 },
  LOW: { firstResponseHours: 24, resolutionHours: 120 },
};

/** Ambang "hampir lewat": sisa waktu ≤ 25% dari target. */
const AT_RISK_RATIO = 0.25;

export function computeDueDates(priority: TicketPriority, from: Date): { firstResponseDueAt: Date; resolutionDueAt: Date } {
  const policy = SLA_POLICY[priority];
  return {
    firstResponseDueAt: new Date(from.getTime() + policy.firstResponseHours * HOUR),
    resolutionDueAt: new Date(from.getTime() + policy.resolutionHours * HOUR),
  };
}

export type SlaState = "met" | "breached" | "at_risk" | "on_track";

function evaluate(start: Date, due: Date, doneAt: Date | null, now: Date): SlaState {
  if (doneAt) return doneAt <= due ? "met" : "breached";
  if (now > due) return "breached";
  const remaining = due.getTime() - now.getTime();
  const total = due.getTime() - start.getTime();
  return remaining <= total * AT_RISK_RATIO ? "at_risk" : "on_track";
}

export interface TicketSla {
  firstResponse: SlaState;
  resolution: SlaState;
}

export function ticketSla(
  t: Pick<Ticket, "createdAt" | "firstResponseDueAt" | "resolutionDueAt" | "firstRespondedAt" | "resolvedAt">,
  now = new Date(),
): TicketSla {
  return {
    firstResponse: evaluate(t.createdAt, t.firstResponseDueAt, t.firstRespondedAt, now),
    resolution: evaluate(t.createdAt, t.resolutionDueAt, t.resolvedAt, now),
  };
}
