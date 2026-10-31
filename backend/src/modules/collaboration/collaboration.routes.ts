// =============================================================================
// REST API MODUL KOLABORASI (prefix /api, wajib login)
//   GET    /team                           direktori rekan (untuk @mention)
//   GET    /customers/search?q=            cari account & contact (untuk Customer 360)
//   GET    /timeline/:entityType/:id       timeline 360° + ringkasan entitas
//   GET    /notes?entityType&entityId      catatan internal sebuah entitas
//   POST   /notes                          tulis catatan (+ @mention -> notifikasi)
//   DELETE /notes/:id                      hapus catatan sendiri
//   GET    /notifications                  notifikasi saya (+ jumlah belum dibaca)
//   POST   /notifications/:id/read         tandai dibaca
//   POST   /notifications/read-all         tandai semua dibaca
// =============================================================================
import { Router } from "express";
import { EntityType } from "@prisma/client";
import { z } from "zod";
import { currentUser, isManager, ownerScope } from "../../lib/auth";
import { HttpError, notFound } from "../../lib/http-error";
import { prisma } from "../../lib/prisma";
import { requireEntityAccess } from "./entity-access";
import { notificationInclude, notifyUsers, toNotificationDTO } from "./notify";
import { buildTimeline } from "./timeline.service";

export const collaborationRouter = Router();

const entityTypeParam = (raw: unknown): EntityType => z.enum(EntityType).parse(String(raw).toUpperCase());

// ---------------------------------------------------------------------------
// Direktori tim & pencarian customer
// ---------------------------------------------------------------------------

collaborationRouter.get("/team", async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
  res.json(users);
});

collaborationRouter.get("/customers/search", async (req, res) => {
  const user = currentUser(res);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const text = q ? { contains: q, mode: "insensitive" as const } : undefined;
  const [accounts, contacts] = await Promise.all([
    prisma.account.findMany({
      where: { ...ownerScope(user), ...(text && { OR: [{ name: text }, { city: text }] }) },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: { id: true, name: true, customerType: true, city: true, businessSector: true },
    }),
    prisma.contact.findMany({
      where: { ...ownerScope(user), ...(text && { OR: [{ name: text }, { phone: { contains: q } }, { email: text }] }) },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: { id: true, name: true, phone: true, city: true, account: { select: { name: true } } },
    }),
  ]);
  res.json({ accounts, contacts });
});

// ---------------------------------------------------------------------------
// Timeline 360°
// ---------------------------------------------------------------------------

collaborationRouter.get("/timeline/:entityType/:id", async (req, res) => {
  const type = entityTypeParam(req.params.entityType);
  const entity = await requireEntityAccess(currentUser(res), type, String(req.params.id));
  const events = await buildTimeline(type, entity.id);
  res.json({ entity, events });
});

// ---------------------------------------------------------------------------
// Catatan internal + @mention
// ---------------------------------------------------------------------------

const noteInclude = {
  author: { select: { id: true, name: true } },
  mentions: { include: { user: { select: { id: true, name: true } } } },
} as const;

collaborationRouter.get("/notes", async (req, res) => {
  const q = z.object({ entityType: z.string(), entityId: z.string().min(1) }).parse(req.query);
  const type = entityTypeParam(q.entityType);
  await requireEntityAccess(currentUser(res), type, q.entityId);
  const notes = await prisma.note.findMany({
    where: { entityType: type, entityId: q.entityId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: noteInclude,
  });
  res.json(notes);
});

const NoteInput = z.object({
  entityType: z.string(),
  entityId: z.string().min(1),
  body: z.string().trim().min(1).max(5000),
  /** Id rekan yang di-@mention (dipilih dari autocomplete, bukan ditebak dari teks). */
  mentionUserIds: z.array(z.string().min(1)).max(20).default([]),
});

collaborationRouter.post("/notes", async (req, res) => {
  const user = currentUser(res);
  const input = NoteInput.parse(req.body);
  const type = entityTypeParam(input.entityType);
  const entity = await requireEntityAccess(user, type, input.entityId);

  // Hanya user aktif yang valid; diri sendiri tidak dihitung sebagai mention.
  const mentionIds = [...new Set(input.mentionUserIds)].filter((id) => id !== user.id);
  const mentioned = mentionIds.length
    ? await prisma.user.findMany({ where: { id: { in: mentionIds }, isActive: true }, select: { id: true } })
    : [];
  if (mentioned.length !== mentionIds.length) throw new HttpError(400, "Ada rekan yang di-mention tidak ditemukan/non-aktif");

  const note = await prisma.note.create({
    data: {
      entityType: type,
      entityId: entity.id,
      body: input.body,
      authorId: user.id,
      mentions: { create: mentioned.map((m) => ({ userId: m.id })) },
    },
    include: noteInclude,
  });

  // Notifikasi dikirim setelah catatan tersimpan.
  await notifyUsers({
    userIds: mentioned.map((m) => m.id),
    type: "MENTION",
    title: `${user.name} menyebut Anda di ${entity.name}`,
    body: input.body.length > 200 ? `${input.body.slice(0, 200)}…` : input.body,
    entity: { type, id: entity.id },
    actorId: user.id,
  });
  res.status(201).json(note);
});

collaborationRouter.delete("/notes/:id", async (req, res) => {
  const user = currentUser(res);
  const note = await prisma.note.findUnique({ where: { id: String(req.params.id) } });
  if (!note) throw notFound("Catatan");
  if (note.authorId !== user.id && !isManager(user)) throw new HttpError(403, "Hanya penulis atau manager yang bisa menghapus catatan");
  await prisma.note.delete({ where: { id: note.id } });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Notifikasi
// ---------------------------------------------------------------------------

collaborationRouter.get("/notifications", async (_req, res) => {
  const user = currentUser(res);
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: notificationInclude,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  res.json({ unread, items: items.map(toNotificationDTO) });
});

collaborationRouter.post("/notifications/read-all", async (_req, res) => {
  const { count } = await prisma.notification.updateMany({
    where: { userId: currentUser(res).id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ updated: count });
});

collaborationRouter.post("/notifications/:id/read", async (req, res) => {
  // userId di filter = user hanya bisa menandai notifikasinya sendiri.
  const { count } = await prisma.notification.updateMany({
    where: { id: String(req.params.id), userId: currentUser(res).id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ updated: count });
});
