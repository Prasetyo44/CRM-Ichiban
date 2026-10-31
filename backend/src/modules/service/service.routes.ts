// =============================================================================
// REST API MODUL SERVICE (prefix /api, wajib login)
//   GET   /tickets               daftar tiket (filter status/kategori/SLA)
//   POST  /tickets               buat tiket (SLA dihitung otomatis)
//   GET   /tickets/:id           detail + percakapan + status SLA
//   PATCH /tickets/:id           ubah status/prioritas/penanggung jawab
//   POST  /tickets/:id/comments  balasan ke customer / catatan internal
// Akses: agent melihat tiket miliknya + antrean belum ditugaskan; manager semua.
// =============================================================================
import { Router } from "express";
import { CustomerType, Prisma, TicketCategory, TicketPriority, TicketStatus, type Ticket } from "@prisma/client";
import { z } from "zod";
import { currentUser, isManager, type AuthUser } from "../../lib/auth";
import { nextDocumentNumber } from "../../lib/document-number";
import { HttpError, notFound } from "../../lib/http-error";
import { prisma } from "../../lib/prisma";
import { computeDueDates, ticketSla } from "./sla";

/** Dipasang di server.ts di belakang middleware `requireAgent`. */
export const serviceRouter = Router();

const visibleTo = (user: AuthUser): Prisma.TicketWhereInput =>
  isManager(user) ? {} : { OR: [{ assigneeId: user.id }, { assigneeId: null }] };

function assertCanSee(user: AuthUser, ticket: Pick<Ticket, "assigneeId">): void {
  if (!isManager(user) && ticket.assigneeId !== null && ticket.assigneeId !== user.id) throw notFound("Tiket");
}

/** Tambahkan status SLA terhitung ke setiap tiket yang dikirim ke klien. */
const withSla = <T extends Ticket>(t: T) => ({ ...t, sla: ticketSla(t) });

const listInclude = {
  assignee: { select: { id: true, name: true } },
  account: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
  productLine: { select: { code: true, name: true } },
} satisfies Prisma.TicketInclude;

serviceRouter.get("/tickets", async (req, res) => {
  const user = currentUser(res);
  const f = z
    .object({
      status: z.enum(TicketStatus).optional(),
      category: z.enum(TicketCategory).optional(),
      open: z.enum(["true", "false"]).optional(),
      sla: z.enum(["breached", "at_risk"]).optional(),
    })
    .parse(req.query);

  const tickets = await prisma.ticket.findMany({
    where: {
      ...visibleTo(user),
      ...(f.status && { status: f.status }),
      ...(f.category && { category: f.category }),
      ...(f.open === "true" && { status: { notIn: ["RESOLVED", "CLOSED"] } }),
    },
    orderBy: [{ resolutionDueAt: "asc" }],
    take: 300,
    include: listInclude,
  });
  const result = tickets.map(withSla);
  // Filter SLA dihitung di aplikasi karena statusnya bergantung waktu sekarang.
  res.json(f.sla ? result.filter((t) => t.sla.resolution === f.sla || t.sla.firstResponse === f.sla) : result);
});

const TicketInput = z.object({
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  category: z.enum(TicketCategory).default("OTHER"),
  priority: z.enum(TicketPriority).default("NORMAL"),
  customerType: z.enum(CustomerType).optional(),
  productLineCode: z.string().optional(),
  batchNumber: z.string().max(64).optional(),
  accountId: z.string().optional(),
  contactId: z.string().optional(),
  dealId: z.string().optional(),
  assigneeId: z.string().optional(),
});

serviceRouter.post("/tickets", async (req, res) => {
  const user = currentUser(res);
  const { productLineCode, assigneeId, ...input } = TicketInput.parse(req.body);

  const productLine = productLineCode
    ? await prisma.productLine.findUnique({ where: { code: productLineCode } })
    : null;
  if (productLineCode && !productLine) throw new HttpError(422, "Lini produk tidak dikenal");

  // Penanggung jawab default: pemilik account/contact (yang paling kenal customer),
  // lalu pembuat tiket. Manager boleh menetapkan orang lain.
  const owner = input.accountId
    ? await prisma.account.findUnique({ where: { id: input.accountId }, select: { ownerId: true } })
    : input.contactId
      ? await prisma.contact.findUnique({ where: { id: input.contactId }, select: { ownerId: true } })
      : null;
  const assignee = (isManager(user) && assigneeId) || owner?.ownerId || user.id;

  const now = new Date();
  const ticket = await prisma.$transaction(async (tx) =>
    tx.ticket.create({
      data: {
        ...input,
        number: await nextDocumentNumber(tx, "TKT", now),
        productLineId: productLine?.id ?? null,
        assigneeId: assignee,
        createdById: user.id,
        ...computeDueDates(input.priority, now),
      },
      include: listInclude,
    }),
  );
  res.status(201).json(withSla(ticket));
});

serviceRouter.get("/tickets/:id", async (req, res) => {
  const user = currentUser(res);
  const ticket = await prisma.ticket.findUnique({
    where: { id: String(req.params.id) },
    include: {
      ...listInclude,
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
    },
  });
  if (!ticket) throw notFound("Tiket");
  assertCanSee(user, ticket);
  res.json(withSla(ticket));
});

const TicketPatch = z.object({
  status: z.enum(TicketStatus).optional(),
  priority: z.enum(TicketPriority).optional(),
  assigneeId: z.string().nullable().optional(),
  category: z.enum(TicketCategory).optional(),
});

serviceRouter.patch("/tickets/:id", async (req, res) => {
  const user = currentUser(res);
  const patch = TicketPatch.parse(req.body);
  const existing = await prisma.ticket.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) throw notFound("Tiket");
  assertCanSee(user, existing);

  const now = new Date();
  const data: Prisma.TicketUncheckedUpdateInput = {};
  if (patch.category) data.category = patch.category;

  // Agent boleh "mengambil" tiket dari antrean; hanya manager yang bisa menugaskan ke orang lain.
  if (patch.assigneeId !== undefined) {
    if (!isManager(user) && patch.assigneeId !== user.id) throw new HttpError(403, "Hanya manager yang bisa menugaskan ke orang lain");
    data.assigneeId = patch.assigneeId;
  }

  // Prioritas berubah -> target SLA dihitung ulang dari waktu pembuatan tiket.
  if (patch.priority && patch.priority !== existing.priority) {
    data.priority = patch.priority;
    Object.assign(data, computeDueDates(patch.priority, existing.createdAt));
  }

  if (patch.status && patch.status !== existing.status) {
    data.status = patch.status;
    if (patch.status === "RESOLVED") data.resolvedAt = now;
    if (patch.status === "CLOSED") {
      data.closedAt = now;
      data.resolvedAt = existing.resolvedAt ?? now;
    }
    // Dibuka ulang -> jam penyelesaian berjalan lagi.
    if (patch.status !== "RESOLVED" && patch.status !== "CLOSED") {
      data.resolvedAt = null;
      data.closedAt = null;
    }
  }

  const ticket = await prisma.ticket.update({ where: { id: existing.id }, data, include: listInclude });
  res.json(withSla(ticket));
});

const CommentInput = z.object({ body: z.string().trim().min(1).max(5000), isInternal: z.boolean().default(false) });

serviceRouter.post("/tickets/:id/comments", async (req, res) => {
  const user = currentUser(res);
  const { body, isInternal } = CommentInput.parse(req.body);
  const ticket = await prisma.ticket.findUnique({ where: { id: String(req.params.id) } });
  if (!ticket) throw notFound("Tiket");
  assertCanSee(user, ticket);

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.ticketComment.create({
      data: { ticketId: ticket.id, authorId: user.id, body, isInternal },
      include: { author: { select: { name: true } } },
    });
    // Balasan publik pertama = respons pertama SLA; tiket OPEN otomatis jadi IN_PROGRESS.
    if (!isInternal) {
      await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          ...(ticket.firstRespondedAt === null && { firstRespondedAt: created.createdAt }),
          ...(ticket.status === "OPEN" && { status: "IN_PROGRESS" }),
        },
      });
    }
    return created;
  });
  res.status(201).json(comment);
});
