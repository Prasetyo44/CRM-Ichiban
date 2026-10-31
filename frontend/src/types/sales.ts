// Tipe DTO modul Sales (cermin respons backend /api/*). Decimal dikirim sebagai string.
import type { CustomerType } from "./crm";

export type DealStage = "QUALIFICATION" | "NEEDS_ANALYSIS" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST";
export type ActivityType = "CALL" | "MEETING" | "EMAIL" | "WHATSAPP" | "VISIT" | "NOTE";
export type TaskStatus = "OPEN" | "DONE" | "CANCELLED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";
export type QuotationStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";

interface Ref {
  id: string;
  name: string;
}

export interface DealSummary {
  id: string;
  title: string;
  customerType: CustomerType;
  stage: DealStage;
  amount: string;
  probability: number;
  expectedCloseDate: string | null;
  lostReason: string | null;
  stageChangedAt: string;
  account: Ref | null;
  contact: Ref | null;
  productLine: { code: string; name: string } | null;
  owner: Ref;
}

export interface Activity {
  id: string;
  type: ActivityType;
  subject: string;
  notes: string | null;
  occurredAt: string;
  author: { name: string };
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  deal?: { id: string; title: string } | null;
}

export interface QuotationSummary {
  id: string;
  number: string;
  status: QuotationStatus;
  total: string;
  validUntil: string | null;
  createdAt: string;
}

export interface DealDetail extends DealSummary {
  activities: Activity[];
  tasks: Task[];
  quotations: QuotationSummary[];
}

export interface QuotationItemDraft {
  productName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPct: number;
}
