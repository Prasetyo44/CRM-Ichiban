// Salinan kontrak DTO & event dari backend/src/types/realtime.ts.
// (Di monorepo, pindahkan ke paket `shared` agar cukup satu definisi.)
export type CustomerType = "B2B" | "B2C";
export type PipelineStage = "NEW" | "CONTACTED" | "PROPOSAL" | "CLOSED";
export type MessageSender = "CUSTOMER" | "AI" | "AGENT" | "SYSTEM";
export type Channel = "WHATSAPP" | "WEB_CHAT" | "INSTAGRAM" | "FACEBOOK" | "EMAIL";
export type EntityType = "ACCOUNT" | "CONTACT" | "DEAL" | "TICKET";
export type ChatSessionStatus = "ai_qualifying" | "pending_assignment" | "assigned_to_human" | "closed";

export interface MessageDTO {
  id: string;
  sessionId: string;
  sender: MessageSender;
  authorId: string | null;
  content: string;
  createdAt: string;
}

export interface ProductLineDTO {
  code: string;
  name: string;
}

export interface LeadDTO {
  id: string;
  externalId: string;
  customerType: CustomerType | null;
  productLine: ProductLineDTO | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  city: string | null;
  companyName: string | null;
  companyScale: string | null;
  businessSector: string | null;
  aiSummary: string | null;
  /** Terisi bila lead sudah dikonversi menjadi Deal. */
  convertedAt: string | null;
  pipelineStage: PipelineStage;
}

export interface SessionDTO {
  id: string;
  channel: Channel;
  status: ChatSessionStatus;
  assignedAgentId: string | null;
  assignedAt: string | null;
  updatedAt: string;
  lead: LeadDTO;
  lastMessage: MessageDTO | null;
}

export interface ServerToClientEvents {
  "session:assigned": (payload: { session: SessionDTO; messages: MessageDTO[] }) => void;
  "message:new": (payload: MessageDTO) => void;
  "lead:updated": (payload: LeadDTO) => void;
  "notification:new": (payload: NotificationDTO) => void;
}

export interface NotificationDTO {
  id: string;
  type: "MENTION" | "TICKET_ASSIGNED";
  title: string;
  body: string | null;
  entityType: EntityType | null;
  entityId: string | null;
  actor: { id: string; name: string } | null;
  readAt: string | null;
  createdAt: string;
}

export type ClientToServerEvents = Record<string, never>;
