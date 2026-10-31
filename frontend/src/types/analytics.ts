// Tipe respons GET /api/analytics/overview (cermin backend analytics.service.ts).
export interface AnalyticsOverview {
  scope: "team" | "self";
  range: { from: string; to: string };
  sales: {
    openPipelineValue: number;
    weightedForecast: number;
    openDeals: number;
    wonCount: number;
    wonValue: number;
    lostCount: number;
    winRate: number;
    avgDealSize: number;
    avgSalesCycleDays: number | null;
  };
  funnel: { key: string; label: string; value: number; ratePct: number }[];
  bySegment: { B2B: number; B2C: number; unknown: number };
  bySales: {
    userId: string;
    name: string;
    openDeals: number;
    openPipelineValue: number;
    wonCount: number;
    wonValue: number;
    winRate: number;
  }[];
  byProductLine: { code: string; name: string; leads: number; wonCount: number; wonValue: number }[];
  service: {
    ticketsCreated: number;
    openTickets: number;
    resolvedTickets: number;
    slaBreached: number;
    slaComplianceRate: number;
    avgFirstResponseHours: number | null;
  };
}
