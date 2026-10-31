// Tipe DTO modul Kolaborasi (cermin respons backend).
import type { CustomerType, EntityType, NotificationDTO } from "./crm";

export type { NotificationDTO };

export interface EntityRef {
  type: EntityType;
  id: string;
  name: string;
  subtitle: string | null;
  ownerId: string | null;
}

export type TimelineKind =
  | "chat"
  | "deal"
  | "activity"
  | "task"
  | "quotation"
  | "ticket"
  | "ticket_comment"
  | "campaign"
  | "note";

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string | null;
  actor: string | null;
  link: { type: EntityType; id: string } | null;
}

export interface TeamMember {
  id: string;
  name: string;
  role: "ADMIN" | "SALES_MANAGER" | "SALES_AGENT";
}

export interface CustomerSearchResult {
  accounts: { id: string; name: string; customerType: CustomerType; city: string | null; businessSector: string | null }[];
  contacts: { id: string; name: string; phone: string | null; city: string | null; account: { name: string } | null }[];
}
