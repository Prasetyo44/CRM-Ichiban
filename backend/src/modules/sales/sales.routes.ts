// =============================================================================
// REST API MODUL SALES (semua di bawah prefix /api, wajib login agent)
//   Accounts   : GET/POST /accounts, GET/PATCH /accounts/:id
//   Contacts   : GET/POST /contacts, PATCH /contacts/:id
//   Leads      : POST /leads/:id/convert
//   Deals      : GET/POST /deals, GET/PATCH /deals/:id, POST /deals/:id/stage
//   Activities : GET/POST /activities
//   Tasks      : GET/POST /tasks, PATCH /tasks/:id
//   Quotations : GET/POST /quotations, GET /quotations/:id, PATCH /quotations/:id/status
// Aturan akses: sales agent hanya melihat/mengubah data miliknya; manager semua.
// =============================================================================
import { Router } from "express";
import {
  ActivityType,
  CustomerType,
  DealStage,
  Prisma,
  QuotationStatus,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";
import { z } from "zod";
import { assertOwner, currentUser, isManager, ownerScope, type AuthUser } from "../../lib/auth";
import { HttpError, notFound } from "../../lib/http-error";
import { prisma } from "../../lib/prisma";
import { calculateQuotation } from "./quotation.calc";
import { nextDocumentNumber } from "../../lib/document-number";
import { changeDealStage, convertLead } from "./sales.service";

/** Dipasang di server.ts di belakang middleware `requireAgent`. */
export const salesRouter = Router();

// ---------------------------------------------------------------------------
// Helper bersama
// ---------------------------------------------------------------------------

const id = (value: unknown): string => String(value);
const optionalText = z.string().trim().max(500).optional();
const optionalId = z.string().min(1).optional();
const isoDate = z.coerce.date();

/** Pastikan relasi yang dirujuk (account/contact/deal) boleh diakses user. */
async function assertLinkedAccess(
  user: AuthUser,
  links: { accountId?: string | undefined; contactId?: string | undefined; dealId?: string | undefined },
): Promise<void> {
  const checks: Promise<void>[] = [];
  if (links.accountId) {
    checks.push(
      prisma.account.findUnique({ where: { id: links.accountId } }).then((a) => {
        if (!a) throw notFound("Account");
        assertOwner(user, a.ownerId, "Account");
      }),
    );
  }
  if (links.contactId) {
    checks.push(
      prisma.contact.findUnique({ where: { id: links.contactId } }).then((c) => {
        if (!c) throw notFound("Contact");
        assertOwner(user, c.ownerId, "Contact");
      }),
    );
  }
  if (links.dealId) {
    checks.push(
      prisma.deal.findUnique({ where: { id: links.dealId } }).then((d) => {
        if (!d) throw notFound("Deal");
        assertOwner(user, d.ownerId, "Deal");
      }),
    );
  }
  await Promise.all(checks);
}

/** Manager boleh menetapkan pemilik lain; sales agent selalu dirinya sendiri. */
const resolveOwner = (user: AuthUser, requested?: string): string =>
  isManager(user) && requested ? requested : user.id;

// ---------------------------------------------------------------------------
// Accounts (perusahaan)
// ---------------------------------------------------------------------------

const AccountInput = z.object({
  name: z.string().trim().min(1).max(200),
  customerType: z.enum(CustomerType).default("B2B"),
  businessSector: optionalText,
  scale: optionalText,
  city: optionalText,
  address: optionalText,
  phone: optionalText,
  email: z.email().optional(),
  taxId: optionalText,
  ownerId: optionalId,
});

salesRouter.get("/accounts", async (req, res) => {
  const user = currentUser(res);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const accounts = await prisma.account.findMany({
    where: { ...ownerScope(user), ...(q && { name: { contains: q, mode: "insensitive" } }) },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { _count: { select: { contacts: true, deals: true } } },
  });
  res.json(accounts);
});

salesRouter.post("/accounts", async (req, res) => {
  const user = currentUser(res);
  const { ownerId, ...data } = AccountInput.parse(req.body);
  const account = await prisma.account.create({ data: { ...data, ownerId: resolveOwner(user, ownerId) } });
  res.status(201).json(account);
});

/** Tampilan 360°: profil, kontak, deal, dan timeline aktivitas satu perusahaan. */
salesRouter.get("/accounts/:id", async (req, res) => {
  const user = currentUser(res);
  const account = await prisma.account.findUnique({
    where: { id: id(req.params.id) },
    include: {
      contacts: { orderBy: { name: "asc" } },
      deals: { orderBy: { updatedAt: "desc" }, include: { productLine: true } },
      activities: { orderBy: { occurredAt: "desc" }, take: 50, include: { author: { select: { name: true } } } },
      tasks: { where: { status: "OPEN" }, orderBy: { dueAt: "asc" } },
    },
  });
  if (!account) throw notFound("Account");
  assertOwner(user, account.ownerId, "Account");
  res.json(account);
});

salesRouter.patch("/accounts/:id", async (req, res) => {
  const user = currentUser(res);
  const existing = await prisma.account.findUnique({ where: { id: id(req.params.id) } });
  if (!existing) throw notFound("Account");
  assertOwner(user, existing.ownerId, "Account");
  const { ownerId, ...data } = AccountInput.partial().parse(req.body);
  const account = await prisma.account.update({
    where: { id: existing.id },
    data: { ...data, ...(ownerId && isManager(user) && { ownerId }) },
  });
  res.json(account);
});

// ---------------------------------------------------------------------------
// Contacts (orang)
// ---------------------------------------------------------------------------

const ContactInput = z.object({
  name: z.string().trim().min(1).max(200),
  accountId: optionalId,
  jobTitle: optionalText,
  phone: optionalText,
  email: z.email().optional(),
  city: optionalText,
  ownerId: optionalId,
});

salesRouter.get("/contacts", async (req, res) => {
  const user = currentUser(res);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const contacts = await prisma.contact.findMany({
    where: {
      ...ownerScope(user),
      ...(q && {
        OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }],
      }),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { account: { select: { id: true, name: true } } },
  });
  res.json(contacts);
});

salesRouter.post("/contacts", async (req, res) => {
  const user = currentUser(res);
  const { ownerId, ...data } = ContactInput.parse(req.body);
  await assertLinkedAccess(user, { accountId: data.accountId });
  const contact = await prisma.contact.create({ data: { ...data, ownerId: resolveOwner(user, ownerId) } });
  res.status(201).json(contact);
});

salesRouter.patch("/contacts/:id", async (req, res) => {
  const user = currentUser(res);
  const existing = await prisma.contact.findUnique({ where: { id: id(req.params.id) } });
  if (!existing) throw notFound("Contact");
  assertOwner(user, existing.ownerId, "Contact");
  const { ownerId, ...data } = ContactInput.partial().parse(req.body);
  await assertLinkedAccess(user, { accountId: data.accountId });
  const contact = await prisma.contact.update({
    where: { id: existing.id },
    data: { ...data, ...(ownerId && isManager(user) && { ownerId }) },
  });
  res.json(contact);
});

// ---------------------------------------------------------------------------
// Konversi Lead -> Account/Contact/Deal
// ---------------------------------------------------------------------------

salesRouter.post("/leads/:id/convert", async (req, res) => {
  const deal = await convertLead(id(req.params.id), currentUser(res));
  res.status(201).json(deal);
});

// ---------------------------------------------------------------------------
// Deals (pipeline)
// ---------------------------------------------------------------------------

const DealInput = z.object({
  title: z.string().trim().min(1).max(200),
  customerType: z.enum(CustomerType),
  amount: z.number().nonnegative().max(1e15).default(0),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: isoDate.optional(),
  accountId: optionalId,
  contactId: optionalId,
  productLineId: optionalId,
  ownerId: optionalId,
});

const dealListInclude = {
  account: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
  productLine: { select: { code: true, name: true } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.DealInclude;

salesRouter.get("/deals", async (req, res) => {
  const user = currentUser(res);
  const Filter = z.object({
    stage: z.enum(DealStage).optional(),
    productLine: z.string().optional(),
    customerType: z.enum(CustomerType).optional(),
  });
  const f = Filter.parse(req.query);
  const deals = await prisma.deal.findMany({
    where: {
      ...ownerScope(user),
      ...(f.stage && { stage: f.stage }),
      ...(f.customerType && { customerType: f.customerType }),
      ...(f.productLine && { productLine: { code: f.productLine } }),
    },
    orderBy: [{ stageChangedAt: "desc" }],
    take: 500,
    include: dealListInclude,
  });
  res.json(deals);
});

salesRouter.post("/deals", async (req, res) => {
  const user = currentUser(res);
  const { ownerId, ...data } = DealInput.parse(req.body);
  await assertLinkedAccess(user, { accountId: data.accountId, contactId: data.contactId });
  const deal = await prisma.deal.create({
    data: { ...data, ownerId: resolveOwner(user, ownerId) },
    include: dealListInclude,
  });
  res.status(201).json(deal);
});

salesRouter.get("/deals/:id", async (req, res) => {
  const user = currentUser(res);
  const deal = await prisma.deal.findUnique({
    where: { id: id(req.params.id) },
    include: {
      ...dealListInclude,
      activities: { orderBy: { occurredAt: "desc" }, include: { author: { select: { name: true } } } },
      tasks: { orderBy: [{ status: "asc" }, { dueAt: "asc" }] },
      quotations: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!deal) throw notFound("Deal");
  assertOwner(user, deal.ownerId, "Deal");
  res.json(deal);
});

salesRouter.patch("/deals/:id", async (req, res) => {
  const user = currentUser(res);
  const existing = await prisma.deal.findUnique({ where: { id: id(req.params.id) } });
  if (!existing) throw notFound("Deal");
  assertOwner(user, existing.ownerId, "Deal");
  // Stage sengaja tidak bisa diubah di sini -> wajib lewat /stage (tervalidasi & tercatat).
  const { ownerId, ...data } = DealInput.partial().parse(req.body);
  await assertLinkedAccess(user, { accountId: data.accountId, contactId: data.contactId });
  const deal = await prisma.deal.update({
    where: { id: existing.id },
    data: { ...data, ...(ownerId && isManager(user) && { ownerId }) },
    include: dealListInclude,
  });
  res.json(deal);
});

const StageInput = z.object({ stage: z.enum(DealStage), lostReason: z.string().max(500).optional() });

salesRouter.post("/deals/:id/stage", async (req, res) => {
  const { stage, lostReason } = StageInput.parse(req.body);
  const deal = await changeDealStage(id(req.params.id), stage, currentUser(res), lostReason);
  res.json(deal);
});

// ---------------------------------------------------------------------------
// Activities (timeline interaksi)
// ---------------------------------------------------------------------------

const ActivityInput = z
  .object({
    type: z.enum(ActivityType),
    subject: z.string().trim().min(1).max(200),
    notes: z.string().max(5000).optional(),
    occurredAt: isoDate.optional(),
    durationMin: z.number().int().positive().max(24 * 60).optional(),
    dealId: optionalId,
    accountId: optionalId,
    contactId: optionalId,
  })
  .refine((a) => a.dealId || a.accountId || a.contactId, "Aktivitas harus terkait deal, account, atau contact");

salesRouter.get("/activities", async (req, res) => {
  const user = currentUser(res);
  const f = z.object({ dealId: optionalId, accountId: optionalId, contactId: optionalId }).parse(req.query);
  if (!f.dealId && !f.accountId && !f.contactId) throw new HttpError(400, "Sertakan dealId, accountId, atau contactId");
  await assertLinkedAccess(user, f);
  const activities = await prisma.activity.findMany({
    where: { ...(f.dealId && { dealId: f.dealId }), ...(f.accountId && { accountId: f.accountId }), ...(f.contactId && { contactId: f.contactId }) },
    orderBy: { occurredAt: "desc" },
    take: 200,
    include: { author: { select: { name: true } } },
  });
  res.json(activities);
});

salesRouter.post("/activities", async (req, res) => {
  const user = currentUser(res);
  const data = ActivityInput.parse(req.body);
  await assertLinkedAccess(user, data);
  const activity = await prisma.activity.create({
    data: { ...data, authorId: user.id },
    include: { author: { select: { name: true } } },
  });
  res.status(201).json(activity);
});

// ---------------------------------------------------------------------------
// Tasks (tindak lanjut)
// ---------------------------------------------------------------------------

const TaskInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueAt: isoDate.optional(),
  priority: z.enum(TaskPriority).default("MEDIUM"),
  assigneeId: optionalId,
  dealId: optionalId,
  accountId: optionalId,
  contactId: optionalId,
});

salesRouter.get("/tasks", async (req, res) => {
  const user = currentUser(res);
  const f = z.object({ status: z.enum(TaskStatus).optional(), dealId: optionalId }).parse(req.query);
  const tasks = await prisma.task.findMany({
    where: {
      ...(isManager(user) ? {} : { assigneeId: user.id }),
      ...(f.status && { status: f.status }),
      ...(f.dealId && { dealId: f.dealId }),
    },
    orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
    take: 200,
    include: { deal: { select: { id: true, title: true } }, assignee: { select: { name: true } } },
  });
  res.json(tasks);
});

salesRouter.post("/tasks", async (req, res) => {
  const user = currentUser(res);
  const { assigneeId, ...data } = TaskInput.parse(req.body);
  await assertLinkedAccess(user, data);
  const task = await prisma.task.create({
    data: { ...data, assigneeId: resolveOwner(user, assigneeId), createdById: user.id },
  });
  res.status(201).json(task);
});

salesRouter.patch("/tasks/:id", async (req, res) => {
  const user = currentUser(res);
  const existing = await prisma.task.findUnique({ where: { id: id(req.params.id) } });
  if (!existing) throw notFound("Task");
  assertOwner(user, existing.assigneeId, "Task");
  const { assigneeId, status, ...data } = TaskInput.partial()
    .extend({ status: z.enum(TaskStatus).optional() })
    .parse(req.body);
  const task = await prisma.task.update({
    where: { id: existing.id },
    data: {
      ...data,
      ...(assigneeId && isManager(user) && { assigneeId }),
      ...(status && { status, completedAt: status === "DONE" ? new Date() : null }),
    },
  });
  res.json(task);
});

// ---------------------------------------------------------------------------
// Quotations (penawaran harga)
// ---------------------------------------------------------------------------

const QuotationInput = z.object({
  dealId: z.string().min(1),
  validUntil: isoDate.optional(),
  notes: z.string().max(2000).optional(),
  discount: z.number().nonnegative().default(0),
  taxPercent: z.number().min(0).max(100).default(11),
  items: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(200),
        sku: z.string().max(64).optional(),
        quantity: z.number().positive(),
        unit: z.string().trim().min(1).max(32),
        unitPrice: z.number().nonnegative(),
        discountPct: z.number().min(0).max(100).optional(),
      }),
    )
    .min(1)
    .max(100),
});

salesRouter.get("/quotations", async (req, res) => {
  const user = currentUser(res);
  const f = z.object({ dealId: optionalId }).parse(req.query);
  const quotations = await prisma.quotation.findMany({
    where: { ...(f.dealId && { dealId: f.dealId }), deal: ownerScope(user) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { deal: { select: { id: true, title: true } } },
  });
  res.json(quotations);
});

salesRouter.get("/quotations/:id", async (req, res) => {
  const user = currentUser(res);
  const quotation = await prisma.quotation.findUnique({
    where: { id: id(req.params.id) },
    include: { items: { orderBy: { sortOrder: "asc" } }, deal: true, account: true },
  });
  if (!quotation) throw notFound("Quotation");
  assertOwner(user, quotation.deal.ownerId, "Quotation");
  res.json(quotation);
});

salesRouter.post("/quotations", async (req, res) => {
  const user = currentUser(res);
  const input = QuotationInput.parse(req.body);
  await assertLinkedAccess(user, { dealId: input.dealId });

  let totals: ReturnType<typeof calculateQuotation>;
  try {
    totals = calculateQuotation(input.items, input.discount, input.taxPercent);
  } catch (e) {
    throw new HttpError(422, e instanceof Error ? e.message : "Quotation tidak valid");
  }

  const quotation = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.findUniqueOrThrow({ where: { id: input.dealId } });
    const created = await tx.quotation.create({
      data: {
        number: await nextDocumentNumber(tx, "QUO"),
        dealId: deal.id,
        accountId: deal.accountId,
        validUntil: input.validUntil ?? null,
        notes: input.notes ?? null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxPercent: totals.taxPercent,
        taxAmount: totals.taxAmount,
        total: totals.total,
        createdById: user.id,
        items: {
          create: totals.items.map((i) => ({
            productName: i.productName,
            sku: i.sku ?? null,
            quantity: i.quantity,
            unit: i.unit,
            unitPrice: i.unitPrice,
            discountPct: i.discountPct ?? 0,
            lineTotal: i.lineTotal,
            sortOrder: i.sortOrder,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    // Nilai deal mengikuti quotation terbaru agar forecast pipeline akurat.
    await tx.deal.update({ where: { id: deal.id }, data: { amount: totals.total } });
    return created;
  });
  res.status(201).json(quotation);
});

salesRouter.patch("/quotations/:id/status", async (req, res) => {
  const user = currentUser(res);
  const { status } = z.object({ status: z.enum(QuotationStatus) }).parse(req.body);
  const existing = await prisma.quotation.findUnique({ where: { id: id(req.params.id) }, include: { deal: true } });
  if (!existing) throw notFound("Quotation");
  assertOwner(user, existing.deal.ownerId, "Quotation");
  const quotation = await prisma.quotation.update({ where: { id: existing.id }, data: { status } });
  res.json(quotation);
});
