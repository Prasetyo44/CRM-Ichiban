// Mapper entity Prisma -> DTO JSON (Date -> ISO string). Dipakai oleh REST API
// dan Socket.IO agar bentuk payload selalu konsisten (satu sumber kebenaran).
import type { ChatSession, Lead, Message, ProductLine } from "@prisma/client";
import type { LeadDTO, MessageDTO, SessionDTO } from "./realtime";

export const toMessageDTO = (m: Message): MessageDTO => ({
  id: m.id,
  sessionId: m.sessionId,
  sender: m.sender,
  authorId: m.authorId,
  content: m.content,
  createdAt: m.createdAt.toISOString(),
});

/** Include Prisma standar agar setiap Lead selalu membawa data lini produknya. */
export const leadInclude = { productLine: true } as const;
type LeadWithLine = Lead & { productLine: ProductLine | null };

export const toLeadDTO = (l: LeadWithLine): LeadDTO => ({
  id: l.id,
  externalId: l.externalId,
  customerType: l.customerType,
  productLine: l.productLine ? { code: l.productLine.code, name: l.productLine.name } : null,
  contactName: l.contactName,
  contactPhone: l.contactPhone,
  contactEmail: l.contactEmail,
  city: l.city,
  companyName: l.companyName,
  companyScale: l.companyScale,
  businessSector: l.businessSector,
  aiSummary: l.aiSummary,
  pipelineStage: l.pipelineStage,
});

export const toSessionDTO = (
  s: ChatSession & { lead: LeadWithLine; messages?: Message[] },
): SessionDTO => {
  const last = s.messages?.at(-1);
  return {
    id: s.id,
    status: s.status,
    assignedAgentId: s.assignedAgentId,
    assignedAt: s.assignedAt?.toISOString() ?? null,
    updatedAt: s.updatedAt.toISOString(),
    lead: toLeadDTO(s.lead),
    lastMessage: last ? toMessageDTO(last) : null,
  };
};
