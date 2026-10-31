// Pembuatan notifikasi + pengiriman real-time (Socket.IO room `agent:<id>`).
import type { EntityType, NotificationType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { emitToAgent } from "../../realtime/socket";
import type { NotificationDTO } from "../../types/realtime";

const notificationInclude = { actor: { select: { id: true, name: true } } } satisfies Prisma.NotificationInclude;
type NotificationRow = Prisma.NotificationGetPayload<{ include: typeof notificationInclude }>;

export const toNotificationDTO = (n: NotificationRow): NotificationDTO => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  entityType: n.entityType,
  entityId: n.entityId,
  actor: n.actor,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

export { notificationInclude };

export interface NotifyInput {
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string | null;
  entity?: { type: EntityType; id: string };
  actorId?: string;
}

/**
 * Buat notifikasi untuk beberapa user lalu dorong lewat socket. Aktor tidak
 * pernah menotifikasi dirinya sendiri. Dipanggil SETELAH transaksi utama
 * commit, supaya klien tidak menerima notifikasi untuk data yang batal disimpan.
 */
export async function notifyUsers(input: NotifyInput): Promise<void> {
  const recipients = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
  for (const userId of recipients) {
    const n = await prisma.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        entityType: input.entity?.type ?? null,
        entityId: input.entity?.id ?? null,
        actorId: input.actorId ?? null,
      },
      include: notificationInclude,
    });
    emitToAgent(userId, "notification:new", toNotificationDTO(n));
  }
}
