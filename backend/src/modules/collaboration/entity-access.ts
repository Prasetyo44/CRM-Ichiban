// Hak akses entitas untuk catatan internal & timeline 360°.
// Aturan: manager/admin melihat semua; agent melihat entitas miliknya
// (ticket: yang ditugaskan kepadanya atau masih di antrean); dan siapa pun
// yang pernah di-@mention di catatan entitas tersebut ikut boleh melihatnya.
import type { EntityType } from "@prisma/client";
import { isManager, type AuthUser } from "../../lib/auth";
import { notFound } from "../../lib/http-error";
import { prisma } from "../../lib/prisma";

const LABEL: Record<EntityType, string> = { ACCOUNT: "Account", CONTACT: "Contact", DEAL: "Deal", TICKET: "Tiket" };

export interface EntityRef {
  type: EntityType;
  id: string;
  /** Judul tampilan, mis. nama account / judul deal / nomor tiket. */
  name: string;
  subtitle: string | null;
  /** Pemilik (ACCOUNT/CONTACT/DEAL) atau penanggung jawab (TICKET). */
  ownerId: string | null;
}

/** Ambil ringkasan entitas; null bila tidak ada. */
export async function loadEntity(type: EntityType, id: string): Promise<EntityRef | null> {
  switch (type) {
    case "ACCOUNT": {
      const a = await prisma.account.findUnique({ where: { id } });
      return a && { type, id, name: a.name, subtitle: [a.customerType, a.businessSector, a.city].filter(Boolean).join(" · "), ownerId: a.ownerId };
    }
    case "CONTACT": {
      const c = await prisma.contact.findUnique({ where: { id }, include: { account: { select: { name: true } } } });
      return c && { type, id, name: c.name, subtitle: [c.jobTitle, c.account?.name, c.city].filter(Boolean).join(" · ") || null, ownerId: c.ownerId };
    }
    case "DEAL": {
      const d = await prisma.deal.findUnique({ where: { id } });
      return d && { type, id, name: d.title, subtitle: `${d.customerType} · ${d.stage}`, ownerId: d.ownerId };
    }
    case "TICKET": {
      const t = await prisma.ticket.findUnique({ where: { id } });
      return t && { type, id, name: `${t.number} — ${t.subject}`, subtitle: t.status, ownerId: t.assigneeId };
    }
  }
}

/** Apakah user pernah di-@mention pada catatan entitas ini? */
async function isMentionedOn(userId: string, type: EntityType, id: string): Promise<boolean> {
  const hit = await prisma.noteMention.findFirst({ where: { userId, note: { entityType: type, entityId: id } }, select: { noteId: true } });
  return hit !== null;
}

/**
 * Muat entitas dan pastikan user boleh melihatnya. Melempar 404 (bukan 403)
 * agar keberadaan data milik orang lain tidak bocor.
 */
export async function requireEntityAccess(user: AuthUser, type: EntityType, id: string): Promise<EntityRef> {
  const entity = await loadEntity(type, id);
  if (!entity) throw notFound(LABEL[type]);
  if (isManager(user) || entity.ownerId === user.id) return entity;
  if (type === "TICKET" && entity.ownerId === null) return entity; // antrean tiket terbuka untuk semua agent
  if (await isMentionedOn(user.id, type, id)) return entity;
  throw notFound(LABEL[type]);
}
