// =============================================================================
// REST API MODUL MARKETING (prefix /api, wajib login)
//   GET    /marketing/options              pilihan filter (lini produk, kota, bidang usaha)
//   POST   /marketing/segments/preview     hitung audiens untuk filter (belum disimpan)
//   GET    /marketing/segments             daftar segmen + jumlah anggota
//   POST   /marketing/segments             buat segmen                 (manager)
//   PATCH  /marketing/segments/:id         ubah segmen                 (manager)
//   DELETE /marketing/segments/:id         hapus segmen tanpa kampanye (manager)
//   GET    /marketing/campaigns            daftar kampanye + statistik kirim
//   GET    /marketing/campaigns/:id        detail + statistik + atribusi deal + penerima
//   POST   /marketing/campaigns            buat draft / jadwalkan      (manager)
//   PATCH  /marketing/campaigns/:id        ubah selama DRAFT/SCHEDULED (manager)
//   POST   /marketing/campaigns/:id/send   kirim sekarang              (manager)
//   POST   /marketing/campaigns/:id/cancel batalkan                    (manager)
//   PATCH  /contacts/:id/consent           ubah persetujuan marketing kontak (pemilik/manager)
// Sales agent boleh melihat segmen & kampanye (untuk follow-up), tetapi hanya
// manager yang boleh membuat dan meluncurkan broadcast.
// =============================================================================
import { Router } from "express";
import { CampaignChannel, Prisma, type RecipientStatus } from "@prisma/client";
import { z } from "zod";
import { assertManager, assertOwner, currentUser } from "../../lib/auth";
import { HttpError, notFound } from "../../lib/http-error";
import { prisma } from "../../lib/prisma";
import { cancelCampaign, launchCampaign } from "./campaign.service";
import { buildContactWhere, eligibleWhere, SegmentFilter } from "./segment.filter";
import { PLACEHOLDERS, unknownPlaceholders } from "./template";

export const marketingRouter = Router();

const id = (value: unknown): string => String(value);

// ---------------------------------------------------------------------------
// Audiens
// ---------------------------------------------------------------------------

/** Hitung ukuran audiens: total cocok & yang benar-benar bisa dikirimi per channel. */
async function audienceOf(filter: SegmentFilter) {
  const where = buildContactWhere(filter);
  const [matched, whatsapp, email, sample] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.count({ where: { AND: [where, eligibleWhere("WHATSAPP")] } }),
    prisma.contact.count({ where: { AND: [where, eligibleWhere("EMAIL")] } }),
    prisma.contact.findMany({
      where,
      take: 8,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        city: true,
        marketingOptIn: true,
        unsubscribedAt: true,
        account: { select: { name: true, customerType: true, city: true } },
      },
    }),
  ]);
  return { matched, eligible: { WHATSAPP: whatsapp, EMAIL: email }, sample };
}

marketingRouter.get("/marketing/options", async (_req, res) => {
  const [productLines, contactCities, accountCities, sectors] = await Promise.all([
    prisma.productLine.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
    prisma.contact.findMany({ where: { city: { not: null } }, distinct: ["city"], select: { city: true } }),
    prisma.account.findMany({ where: { city: { not: null } }, distinct: ["city"], select: { city: true } }),
    prisma.account.findMany({ where: { businessSector: { not: null } }, distinct: ["businessSector"], select: { businessSector: true } }),
  ]);
  const uniqSorted = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  res.json({
    productLines,
    cities: uniqSorted([...contactCities, ...accountCities].map((c) => c.city)),
    businessSectors: uniqSorted(sectors.map((s) => s.businessSector)),
    placeholders: PLACEHOLDERS,
  });
});

marketingRouter.post("/marketing/segments/preview", async (req, res) => {
  const filter = SegmentFilter.parse(req.body?.filter ?? {});
  res.json(await audienceOf(filter));
});

// ---------------------------------------------------------------------------
// Segmen
// ---------------------------------------------------------------------------

const SegmentInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  filter: SegmentFilter,
});

marketingRouter.get("/marketing/segments", async (_req, res) => {
  const segments = await prisma.segment.findMany({
    orderBy: { updatedAt: "desc" },
    include: { createdBy: { select: { id: true, name: true } }, _count: { select: { campaigns: true } } },
  });
  // Ukuran dihitung ulang tiap kali (segmen dinamis). Jumlah segmen kecil,
  // dan masing-masing hanya beberapa COUNT berindeks.
  const withSize = await Promise.all(
    segments.map(async (s) => {
      const parsed = SegmentFilter.safeParse(s.filter);
      const audience = parsed.success ? await audienceOf(parsed.data) : null;
      return {
        ...s,
        filterValid: parsed.success,
        matched: audience?.matched ?? 0,
        eligible: audience?.eligible ?? { WHATSAPP: 0, EMAIL: 0 },
      };
    }),
  );
  res.json(withSize);
});

marketingRouter.post("/marketing/segments", async (req, res) => {
  const user = currentUser(res);
  assertManager(user, "membuat segmen");
  const input = SegmentInput.parse(req.body);
  const segment = await prisma.segment.create({ data: { ...input, createdById: user.id } });
  res.status(201).json(segment);
});

marketingRouter.patch("/marketing/segments/:id", async (req, res) => {
  assertManager(currentUser(res), "mengubah segmen");
  const input = SegmentInput.partial().parse(req.body);
  const existing = await prisma.segment.findUnique({ where: { id: id(req.params.id) } });
  if (!existing) throw notFound("Segmen");
  res.json(await prisma.segment.update({ where: { id: existing.id }, data: input }));
});

marketingRouter.delete("/marketing/segments/:id", async (req, res) => {
  assertManager(currentUser(res), "menghapus segmen");
  const segment = await prisma.segment.findUnique({
    where: { id: id(req.params.id) },
    include: { _count: { select: { campaigns: true } } },
  });
  if (!segment) throw notFound("Segmen");
  // Riwayat kampanye harus tetap bisa ditelusuri ke segmennya.
  if (segment._count.campaigns > 0) throw new HttpError(409, "Segmen sudah dipakai kampanye dan tidak bisa dihapus");
  await prisma.segment.delete({ where: { id: segment.id } });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Kampanye
// ---------------------------------------------------------------------------

type RecipientStats = Record<RecipientStatus, number> & { total: number };

/** Statistik penerima untuk banyak kampanye sekaligus (satu query groupBy). */
async function recipientStats(campaignIds: string[]): Promise<Map<string, RecipientStats>> {
  const rows = await prisma.campaignRecipient.groupBy({
    by: ["campaignId", "status"],
    where: { campaignId: { in: campaignIds } },
    _count: { _all: true },
  });
  const map = new Map<string, RecipientStats>();
  for (const cid of campaignIds) map.set(cid, { total: 0, PENDING: 0, SENT: 0, FAILED: 0, SKIPPED: 0 });
  for (const r of rows) {
    const s = map.get(r.campaignId);
    if (!s) continue;
    s[r.status] = r._count._all;
    s.total += r._count._all;
  }
  return map;
}

const campaignInclude = {
  segment: { select: { id: true, name: true } },
  productLine: { select: { code: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.CampaignInclude;

const CampaignInput = z
  .object({
    name: z.string().trim().min(1).max(150),
    channel: z.enum(CampaignChannel),
    segmentId: z.string().min(1),
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().min(1).max(2000),
    productLineCode: z.string().optional(),
    /** Diisi = dijadwalkan; kosong/null = tetap draft. */
    scheduledAt: z.coerce.date().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const unknown = unknownPlaceholders(v.body);
    if (unknown.length) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: `Placeholder tidak dikenal: ${unknown.map((u) => `{{${u}}}`).join(", ")}. Yang tersedia: ${PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}`,
      });
    }
    if (v.channel === "EMAIL" && !v.subject) {
      ctx.addIssue({ code: "custom", path: ["subject"], message: "Subjek wajib diisi untuk kampanye email" });
    }
    if (v.scheduledAt && v.scheduledAt.getTime() < Date.now() - 60_000) {
      ctx.addIssue({ code: "custom", path: ["scheduledAt"], message: "Jadwal tidak boleh di masa lalu" });
    }
  });

async function resolveCampaignRefs(input: { segmentId?: string; productLineCode?: string }) {
  if (input.segmentId) {
    const segment = await prisma.segment.findUnique({ where: { id: input.segmentId }, select: { id: true } });
    if (!segment) throw new HttpError(400, "Segmen tidak ditemukan");
  }
  if (input.productLineCode === undefined) return {};
  if (input.productLineCode === "") return { productLineId: null };
  const line = await prisma.productLine.findUnique({ where: { code: input.productLineCode }, select: { id: true } });
  if (!line) throw new HttpError(400, "Lini produk tidak dikenal");
  return { productLineId: line.id };
}

marketingRouter.get("/marketing/campaigns", async (_req, res) => {
  const campaigns = await prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: campaignInclude });
  const stats = await recipientStats(campaigns.map((c) => c.id));
  res.json(campaigns.map((c) => ({ ...c, stats: stats.get(c.id) })));
});

/** Jendela atribusi: deal yang dibuat kontak penerima dalam N hari setelah pesan terkirim. */
const ATTRIBUTION_DAYS = 30;

marketingRouter.get("/marketing/campaigns/:id", async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: id(req.params.id) }, include: campaignInclude });
  if (!campaign) throw notFound("Kampanye");

  const [stats, recipients, attribution] = await Promise.all([
    recipientStats([campaign.id]),
    prisma.campaignRecipient.findMany({
      where: { campaignId: campaign.id },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: 100,
      include: { contact: { select: { id: true, name: true, account: { select: { name: true } } } } },
    }),
    // Atribusi "influenced": deal (di lini produk kampanye bila diisi) yang
    // dibuat kontak penerima dalam 30 hari setelah pesan diterima.
    prisma.$queryRaw<{ deals: number; won: number; wonValue: Prisma.Decimal | null }[]>`
      SELECT count(DISTINCT d.id)::int AS deals,
             count(DISTINCT d.id) FILTER (WHERE d.stage = 'WON')::int AS won,
             sum(d.amount) FILTER (WHERE d.stage = 'WON') AS "wonValue"
      FROM campaign_recipients r
      JOIN deals d ON d."contactId" = r."contactId"
      WHERE r."campaignId" = ${campaign.id} AND r.status = 'SENT'
        AND d."createdAt" >= r."sentAt"
        AND d."createdAt" < r."sentAt" + make_interval(days => ${ATTRIBUTION_DAYS}::int)
        AND (${campaign.productLineId}::text IS NULL OR d."productLineId" = ${campaign.productLineId})`,
  ]);
  const a = attribution[0];
  res.json({
    ...campaign,
    stats: stats.get(campaign.id),
    attribution: {
      windowDays: ATTRIBUTION_DAYS,
      deals: a?.deals ?? 0,
      won: a?.won ?? 0,
      wonValue: Number(a?.wonValue ?? 0),
    },
    recipients,
  });
});

marketingRouter.post("/marketing/campaigns", async (req, res) => {
  const user = currentUser(res);
  assertManager(user, "membuat kampanye");
  const { productLineCode, scheduledAt, ...data } = CampaignInput.parse(req.body);
  const refs = await resolveCampaignRefs({ segmentId: data.segmentId, productLineCode });
  const campaign = await prisma.campaign.create({
    data: {
      ...data,
      ...refs,
      subject: data.channel === "EMAIL" ? data.subject : null,
      scheduledAt: scheduledAt ?? null,
      status: scheduledAt ? "SCHEDULED" : "DRAFT",
      createdById: user.id,
    },
    include: campaignInclude,
  });
  res.status(201).json(campaign);
});

marketingRouter.patch("/marketing/campaigns/:id", async (req, res) => {
  assertManager(currentUser(res), "mengubah kampanye");
  const existing = await prisma.campaign.findUnique({ where: { id: id(req.params.id) } });
  if (!existing) throw notFound("Kampanye");

  // Validasi ulang gabungan data lama + perubahan (mis. ganti channel ke EMAIL wajib subjek).
  const patch = z.record(z.string(), z.unknown()).parse(req.body);
  const merged = CampaignInput.parse({
    name: existing.name,
    channel: existing.channel,
    segmentId: existing.segmentId,
    subject: existing.subject ?? undefined,
    body: existing.body,
    scheduledAt: existing.scheduledAt,
    ...patch,
  });
  const { productLineCode, scheduledAt, ...data } = merged;
  const refs = await resolveCampaignRefs({ segmentId: data.segmentId, productLineCode });

  // updateMany + filter status = compare-and-set atomik: bila kampanye sudah
  // diluncurkan di antara baca & tulis, tidak ada baris yang berubah.
  const { count } = await prisma.campaign.updateMany({
    where: { id: existing.id, status: { in: ["DRAFT", "SCHEDULED"] } },
    data: {
      ...data,
      ...refs,
      subject: data.channel === "EMAIL" ? data.subject : null,
      scheduledAt: scheduledAt ?? null,
      status: scheduledAt ? "SCHEDULED" : "DRAFT",
    },
  });
  if (count === 0) throw new HttpError(409, "Kampanye sudah dikirim/dibatalkan dan tidak bisa diubah");
  res.json(await prisma.campaign.findUniqueOrThrow({ where: { id: existing.id }, include: campaignInclude }));
});

marketingRouter.post("/marketing/campaigns/:id/send", async (req, res) => {
  assertManager(currentUser(res), "mengirim kampanye");
  const result = await launchCampaign(id(req.params.id));
  if (result.status === "already_started") throw new HttpError(409, "Kampanye sudah dikirim atau dibatalkan");
  res.status(202).json(result);
});

marketingRouter.post("/marketing/campaigns/:id/cancel", async (req, res) => {
  assertManager(currentUser(res), "membatalkan kampanye");
  await cancelCampaign(id(req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Consent kontak
// ---------------------------------------------------------------------------

marketingRouter.patch("/contacts/:id/consent", async (req, res) => {
  const user = currentUser(res);
  const { optIn } = z.object({ optIn: z.boolean() }).parse(req.body);
  const contact = await prisma.contact.findUnique({ where: { id: id(req.params.id) } });
  if (!contact) throw notFound("Contact");
  assertOwner(user, contact.ownerId, "Contact");
  const updated = await prisma.contact.update({
    where: { id: contact.id },
    data: optIn
      ? { marketingOptIn: true, marketingOptInAt: new Date(), unsubscribedAt: null }
      : { marketingOptIn: false, unsubscribedAt: new Date() },
  });
  res.json(updated);
});
