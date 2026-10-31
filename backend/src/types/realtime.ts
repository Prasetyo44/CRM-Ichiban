// Kontrak event Socket.IO yang dipakai bersama backend & frontend.
// Frontend menyalin tipe ini (lihat frontend/src/types/crm.ts) agar payload
// real-time fully-typed di kedua sisi.
import type {
  ChatSessionStatus,
  CustomerType,
  MessageSender,
  PipelineStage,
} from "@prisma/client";

export interface MessageDTO {
  id: string;
  sessionId: string;
  sender: MessageSender;
  authorId: string | null;
  content: string;
  createdAt: string; // ISO-8601
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
  pipelineStage: PipelineStage;
}

export interface SessionDTO {
  id: string;
  status: ChatSessionStatus;
  assignedAgentId: string | null;
  assignedAt: string | null;
  updatedAt: string;
  lead: LeadDTO;
  lastMessage: MessageDTO | null;
}

/** Event server -> client (dashboard sales). */
export interface ServerToClientEvents {
  /** Sesi baru dialihkan ke agent ini (berisi ringkasan AI + histori chat). */
  "session:assigned": (payload: { session: SessionDTO; messages: MessageDTO[] }) => void;
  /** Pesan baru pada sesi milik agent ini (dari customer atau agent sendiri). */
  "message:new": (payload: MessageDTO) => void;
  /** Data lead berubah (mis. pipeline stage diperbarui dari tab lain). */
  "lead:updated": (payload: LeadDTO) => void;
}

/** Event client -> server. Dashboard hanya mendengarkan; aksi tulis lewat REST. */
export type ClientToServerEvents = Record<string, never>;
