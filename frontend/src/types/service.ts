// Tipe DTO modul Service (cermin respons backend /api/tickets).
import type { CustomerType } from "./crm";

export type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type TicketCategory =
  | "PRODUCT_QUALITY"
  | "DELIVERY"
  | "TECHNICAL_SUPPORT"
  | "WARRANTY_CLAIM"
  | "BILLING"
  | "OTHER";
export type SlaState = "met" | "breached" | "at_risk" | "on_track";

interface Ref {
  id: string;
  name: string;
}

export interface Ticket {
  id: string;
  number: string;
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  customerType: CustomerType | null;
  batchNumber: string | null;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  createdAt: string;
  assignee: Ref | null;
  account: Ref | null;
  contact: Ref | null;
  productLine: { code: string; name: string } | null;
  sla: { firstResponse: SlaState; resolution: SlaState };
}

export interface TicketComment {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: { name: string };
}

export interface TicketDetail extends Ticket {
  comments: TicketComment[];
}
