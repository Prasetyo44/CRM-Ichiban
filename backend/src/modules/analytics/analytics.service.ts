// =============================================================================
// MODUL ANALITIK (CRM Analitis)
// -----------------------------------------------------------------------------
// Satu endpoint ringkasan untuk dashboard: funnel lead→won, KPI penjualan,
// performa per sales & per lini produk, serta kesehatan layanan (SLA).
// Cakupan data: manager = seluruh tim; sales agent = data miliknya sendiri.
// Semua agregasi dilakukan di database (groupBy/aggregate), bukan di memori.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { isManager, type AuthUser } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { ticketSla } from "../service/sla";

export interface DateRange {
  from: Date;
  to: Date;
}

const DAY = 24 * 60 * 60 * 1000;
const num = (v: Prisma.Decimal | null | undefined): number => (v ? Number(v) : 0);
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export async function getAnalyticsOverview(user: AuthUser, range: DateRange) {
  const manager = isManager(user);
  const inRange = { gte: range.from, lt: range.to };
  // Filter kepemilikan per entitas.
  const dealScope: Prisma.DealWhereInput = manager ? {} : { ownerId: user.id };
  const sessionScope: Prisma.ChatSessionWhereInput = manager ? {} : { assignedAgentId: user.id };
  const leadScope: Prisma.LeadWhereInput = manager ? {} : { sessions: { some: sessionScope } };
  const ticketScope: Prisma.TicketWhereInput = manager ? {} : { assigneeId: user.id };

  // Funnel memakai KOHORT: lead yang masuk dalam periode, tiap tahap mensyaratkan
  // tahap sebelumnya, sehingga angka selalu menurun dan bisa dibandingkan.
  const cohort: Prisma.LeadWhereInput = { ...leadScope, createdAt: inRange };
  const qualifiedSession: Prisma.ChatSessionWhereInput = { qualifiedAt: { not: null } };
  const assignedSession: Prisma.ChatSessionWhereInput = {
    ...sessionScope,
    qualifiedAt: { not: null },
    assignedAgentId: { not: null },
  };

  const [
    leadsTotal,
    leadsQualified,
    leadsAssigned,
    leadsConverted,
    leadsWon,
    leadsBySegment,
    openDeals,
    wonDeals,
    lostCount,
    dealsByOwner,
    wonByOwner,
    wonByLine,
    leadsByLine,
    productLines,
    users,
    tickets,
  ] = await Promise.all([
    prisma.lead.count({ where: cohort }),
    prisma.lead.count({ where: { ...cohort, sessions: { some: qualifiedSession } } }),
    prisma.lead.count({ where: { ...cohort, sessions: { some: assignedSession } } }),
    prisma.lead.count({ where: { ...cohort, sessions: { some: assignedSession }, convertedAt: { not: null } } }),
    prisma.lead.count({
      where: { ...cohort, sessions: { some: assignedSession }, convertedAt: { not: null }, deal: { stage: "WON" } },
    }),
    prisma.lead.groupBy({ by: ["customerType"], where: { ...leadScope, createdAt: inRange }, _count: true }),
    // Pipeline terbuka = kondisi saat ini (tidak dibatasi periode).
    prisma.deal.findMany({
      where: { ...dealScope, stage: { notIn: ["WON", "LOST"] } },
      select: { amount: true, probability: true },
    }),
    prisma.deal.findMany({
      where: { ...dealScope, stage: "WON", closedAt: inRange },
      select: { amount: true, createdAt: true, closedAt: true },
    }),
    prisma.deal.count({ where: { ...dealScope, stage: "LOST", closedAt: inRange } }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { ...dealScope, stage: { notIn: ["WON", "LOST"] } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.deal.groupBy({
      by: ["ownerId", "stage"],
      where: { ...dealScope, stage: { in: ["WON", "LOST"] }, closedAt: inRange },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.deal.groupBy({
      by: ["productLineId"],
      where: { ...dealScope, stage: "WON", closedAt: inRange },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.lead.groupBy({ by: ["productLineId"], where: { ...leadScope, createdAt: inRange }, _count: true }),
    prisma.productLine.findMany({ select: { id: true, code: true, name: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({
      where: manager ? { role: "SALES_AGENT" } : { id: user.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.ticket.findMany({
      where: { ...ticketScope, createdAt: inRange },
      select: {
        status: true,
        createdAt: true,
        firstResponseDueAt: true,
        resolutionDueAt: true,
        firstRespondedAt: true,
        resolvedAt: true,
      },
    }),
  ]);

  // --- Penjualan -------------------------------------------------------------
  const wonValue = wonDeals.reduce((s, d) => s + num(d.amount), 0);
  const cycleDays = wonDeals
    .filter((d) => d.closedAt)
    .map((d) => ((d.closedAt as Date).getTime() - d.createdAt.getTime()) / DAY);
  const sales = {
    openPipelineValue: openDeals.reduce((s, d) => s + num(d.amount), 0),
    weightedForecast: openDeals.reduce((s, d) => s + (num(d.amount) * d.probability) / 100, 0),
    openDeals: openDeals.length,
    wonCount: wonDeals.length,
    wonValue,
    lostCount,
    winRate: pct(wonDeals.length, wonDeals.length + lostCount),
    avgDealSize: wonDeals.length ? wonValue / wonDeals.length : 0,
    avgSalesCycleDays: cycleDays.length ? Math.round((cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length) * 10) / 10 : null,
  };

  // --- Funnel ----------------------------------------------------------------
  const funnel = [
    { key: "leads", label: "Lead masuk", value: leadsTotal },
    { key: "qualified", label: "Lolos kualifikasi AI", value: leadsQualified },
    { key: "assigned", label: "Dialihkan ke sales", value: leadsAssigned },
    { key: "converted", label: "Menjadi deal", value: leadsConverted },
    { key: "won", label: "Deal menang", value: leadsWon },
  ].map((step) => ({ ...step, ratePct: pct(step.value, leadsTotal) }));

  // --- Per sales -------------------------------------------------------------
  const bySales = users.map((u) => {
    const open = dealsByOwner.find((d) => d.ownerId === u.id);
    const won = wonByOwner.find((d) => d.ownerId === u.id && d.stage === "WON");
    const lost = wonByOwner.find((d) => d.ownerId === u.id && d.stage === "LOST");
    const wonCount = won?._count ?? 0;
    const lostCnt = lost?._count ?? 0;
    return {
      userId: u.id,
      name: u.name,
      openDeals: open?._count ?? 0,
      openPipelineValue: num(open?._sum.amount),
      wonCount,
      wonValue: num(won?._sum.amount),
      winRate: pct(wonCount, wonCount + lostCnt),
    };
  });

  // --- Per lini produk ---------------------------------------------------------
  const byProductLine = productLines.map((line) => {
    const won = wonByLine.find((w) => w.productLineId === line.id);
    return {
      code: line.code,
      name: line.name,
      leads: leadsByLine.find((l) => l.productLineId === line.id)?._count ?? 0,
      wonCount: won?._count ?? 0,
      wonValue: num(won?._sum.amount),
    };
  });

  // --- Segmen ------------------------------------------------------------------
  const bySegment = {
    B2B: leadsBySegment.find((s) => s.customerType === "B2B")?._count ?? 0,
    B2C: leadsBySegment.find((s) => s.customerType === "B2C")?._count ?? 0,
    unknown: leadsBySegment.find((s) => s.customerType === null)?._count ?? 0,
  };

  // --- Service -----------------------------------------------------------------
  const now = new Date();
  const slaStates = tickets.map((t) => ticketSla(t, now));
  const responded = tickets.filter((t) => t.firstRespondedAt);
  const service = {
    ticketsCreated: tickets.length,
    openTickets: tickets.filter((t) => t.status !== "RESOLVED" && t.status !== "CLOSED").length,
    resolvedTickets: tickets.filter((t) => t.resolvedAt).length,
    slaBreached: slaStates.filter((s) => s.firstResponse === "breached" || s.resolution === "breached").length,
    slaComplianceRate: pct(
      slaStates.filter((s) => s.firstResponse !== "breached" && s.resolution !== "breached").length,
      tickets.length,
    ),
    avgFirstResponseHours: responded.length
      ? Math.round(
          (responded.reduce((s, t) => s + ((t.firstRespondedAt as Date).getTime() - t.createdAt.getTime()), 0) /
            responded.length /
            3_600_000) *
            10,
        ) / 10
      : null,
  };

  return {
    scope: manager ? "team" : "self",
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    sales,
    funnel,
    bySegment,
    bySales,
    byProductLine,
    service,
  };
}

export type AnalyticsOverview = Awaited<ReturnType<typeof getAnalyticsOverview>>;
