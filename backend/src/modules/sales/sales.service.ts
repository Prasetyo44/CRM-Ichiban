// Layanan transaksional modul Sales: konversi lead, perubahan stage, nomor dokumen.
import { Prisma, type DealStage } from "@prisma/client";
import type { AuthUser } from "../../lib/auth";
import { HttpError, notFound } from "../../lib/http-error";
import { prisma } from "../../lib/prisma";
import { STAGE_PROBABILITY, isClosedStage, validateStageChange } from "./deal.rules";

type Tx = Prisma.TransactionClient;

/**
 * Nomor dokumen berurutan & unik, aman untuk request paralel:
 * INSERT ... ON CONFLICT DO UPDATE bersifat atomik di PostgreSQL.
 */
export async function nextDocumentNumber(tx: Tx, prefix: string, at = new Date()): Promise<string> {
  const period = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, "0")}`;
  const key = `${prefix}-${period}`;
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO counters (key, value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
    RETURNING value`;
  if (!row) throw new Error("Gagal membuat nomor dokumen");
  return `${key}-${String(row.value).padStart(4, "0")}`;
}

/**
 * Konversi Lead hasil chat menjadi data CRM:
 *   B2B -> Account (perusahaan) + Contact (PIC) + Deal
 *   B2C -> Contact (perorangan) + Deal
 * Idempoten: lead yang sudah dikonversi mengembalikan deal yang sama.
 * Pemilik data = sales yang memegang sesi chat lead tersebut.
 */
export async function convertLead(leadId: string, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    // Kunci baris lead agar dua klik "Konversi" bersamaan tidak membuat deal ganda.
    await tx.$queryRaw`SELECT id FROM leads WHERE id = ${leadId} FOR UPDATE`;
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      include: { deal: true, productLine: true, sessions: { select: { assignedAgentId: true } } },
    });
    if (!lead) throw notFound("Lead");

    const handledBy = lead.sessions.map((s) => s.assignedAgentId);
    if (user.role === "SALES_AGENT" && !handledBy.includes(user.id)) throw notFound("Lead");
    if (lead.deal) return lead.deal;
    if (!lead.customerType) throw new HttpError(409, "Segmen lead (B2B/B2C) belum diketahui");

    const ownerId = handledBy.find((id): id is string => Boolean(id)) ?? user.id;
    const isB2B = lead.customerType === "B2B";

    const account = isB2B
      ? await tx.account.create({
          data: {
            name: lead.companyName ?? lead.contactName ?? lead.externalId,
            customerType: "B2B",
            businessSector: lead.businessSector,
            scale: lead.companyScale,
            city: lead.city,
            phone: lead.contactPhone,
            email: lead.contactEmail,
            ownerId,
          },
        })
      : null;

    const contact = await tx.contact.create({
      data: {
        name: lead.contactName ?? lead.companyName ?? lead.externalId,
        phone: lead.contactPhone ?? lead.externalId,
        email: lead.contactEmail,
        city: lead.city,
        accountId: account?.id ?? null,
        ownerId,
      },
    });

    const deal = await tx.deal.create({
      data: {
        title: `${lead.productLine?.name ?? "Peluang"} — ${account?.name ?? contact.name}`,
        customerType: lead.customerType,
        leadId: lead.id,
        accountId: account?.id ?? null,
        contactId: contact.id,
        productLineId: lead.productLineId,
        ownerId,
        probability: STAGE_PROBABILITY.QUALIFICATION,
      },
    });

    // Ringkasan AI dibawa sebagai catatan pertama di timeline deal.
    if (lead.aiSummary) {
      await tx.activity.create({
        data: {
          type: "NOTE",
          subject: "Ringkasan kualifikasi AI",
          notes: lead.aiSummary,
          authorId: user.id,
          dealId: deal.id,
          accountId: account?.id ?? null,
          contactId: contact.id,
        },
      });
    }

    await tx.lead.update({
      where: { id: lead.id },
      data: { accountId: account?.id ?? null, contactId: contact.id, convertedAt: new Date() },
    });
    return deal;
  });
}

/** Pindahkan deal ke stage baru + catat di timeline sebagai aktivitas. */
export async function changeDealStage(
  dealId: string,
  to: DealStage,
  user: AuthUser,
  lostReason?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM deals WHERE id = ${dealId} FOR UPDATE`;
    const deal = await tx.deal.findUnique({ where: { id: dealId } });
    if (!deal || (user.role === "SALES_AGENT" && deal.ownerId !== user.id)) throw notFound("Deal");

    const error = validateStageChange(deal.stage, to, lostReason);
    if (error) throw new HttpError(422, error);

    const updated = await tx.deal.update({
      where: { id: dealId },
      data: {
        stage: to,
        probability: STAGE_PROBABILITY[to],
        stageChangedAt: new Date(),
        closedAt: isClosedStage(to) ? new Date() : null,
        lostReason: to === "LOST" ? lostReason?.trim() ?? null : null,
      },
    });
    await tx.activity.create({
      data: {
        type: "NOTE",
        subject: `Stage: ${deal.stage} → ${to}`,
        notes: to === "LOST" ? `Alasan: ${lostReason}` : null,
        authorId: user.id,
        dealId,
        accountId: deal.accountId,
        contactId: deal.contactId,
      },
    });
    return updated;
  });
}
