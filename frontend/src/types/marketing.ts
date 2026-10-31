// Tipe DTO modul Marketing (cermin respons backend /api/marketing/*).
import type { CustomerType } from "./crm";

export type CampaignChannel = "WHATSAPP" | "EMAIL";
export type CampaignStatus = "DRAFT" | "SCHEDULED" | "SENDING" | "SENT" | "CANCELLED";
export type RecipientStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";
export type CustomerStatusFilter = "any" | "customer" | "prospect";

export interface SegmentFilter {
  customerType?: CustomerType;
  productLineCodes?: string[];
  cities?: string[];
  businessSectors?: string[];
  customerStatus: CustomerStatusFilter;
}

export interface MarketingOptions {
  productLines: { code: string; name: string }[];
  cities: string[];
  businessSectors: string[];
  placeholders: string[];
}

export interface AudiencePreview {
  matched: number;
  eligible: Record<CampaignChannel, number>;
  sample: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    marketingOptIn: boolean;
    unsubscribedAt: string | null;
    account: { name: string; customerType: CustomerType; city: string | null } | null;
  }[];
}

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  filter: SegmentFilter;
  filterValid: boolean;
  matched: number;
  eligible: Record<CampaignChannel, number>;
  createdBy: { id: string; name: string };
  _count: { campaigns: number };
  updatedAt: string;
}

export type RecipientStats = Record<RecipientStatus, number> & { total: number };

export interface Campaign {
  id: string;
  name: string;
  channel: CampaignChannel;
  subject: string | null;
  body: string;
  status: CampaignStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  segment: { id: string; name: string };
  productLine: { code: string; name: string } | null;
  createdBy: { id: string; name: string };
  stats?: RecipientStats;
}

export interface CampaignDetail extends Campaign {
  stats: RecipientStats;
  attribution: { windowDays: number; deals: number; won: number; wonValue: number };
  recipients: {
    id: string;
    address: string;
    status: RecipientStatus;
    error: string | null;
    sentAt: string | null;
    contact: { id: string; name: string; account: { name: string } | null };
  }[];
}
