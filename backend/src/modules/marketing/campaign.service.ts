// =============================================================================
// Mesin kampanye broadcast.
//
//   launchCampaign   : DRAFT/SCHEDULED -> SENDING. Membekukan daftar penerima
//                      (segmen dievaluasi SEKALI di sini) ke campaign_recipients.
//   dispatchCampaign : mengirim antrean PENDING per batch. Aman dijalankan
//                      paralel (beberapa proses/instance) karena tiap batch
//                      diklaim dengan `FOR UPDATE SKIP LOCKED`.
//   cancelCampaign   : hentikan kampanye; sisa antrean ditandai SKIPPED.
//   startCampaignScheduler : timer yang meluncurkan kampanye terjadwal dan
//                      melanjutkan kampanye SENDING setelah server restart.
//
// Jaminan "satu kontak tidak menerima pesan yang sama dua kali":
//   1. baris campaign dikunci (FOR UPDATE) saat peluncuran -> hanya satu
//      pemanggil yang melihat status DRAFT/SCHEDULED;
//   2. unique (campaignId, contactId) di campaign_recipients;
//   3. baris penerima dikunci selama dikirim & langsung diberi status akhir.
// =============================================================================
import { Prisma, type CampaignStatus } from "@prisma/client";
import { HttpError, notFound } from "../../lib/http-error";
import { prisma } from "../../lib/prisma";
import { sendMarketingMessage } from "./marketing.outbound";
import { addressFor, buildContactWhere, eligibleWhere, normalizePhone, SegmentFilter } from "./segment.filter";
import { renderMessage } from "./template";

const BATCH_SIZE = 25;
/** Jeda antar pesan agar tidak terkena rate limit penyedia WhatsApp/email. */
const SEND_DELAY_MS = Number(process.env.MARKETING_SEND_DELAY_MS ?? 20);
const SCHEDULER_INTERVAL_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Kunci baris kampanye di dalam transaksi dan kembalikan statusnya. */
async function lockCampaign(tx: Prisma.TransactionClient, campaignId: string): Promise<CampaignStatus> {
  const [row] = await tx.$queryRaw<{ status: CampaignStatus }[]>`
    SELECT status FROM campaigns WHERE id = ${campaignId} FOR UPDATE`;
  if (!row) throw notFound("Kampanye");
  return row.status;
}

export type LaunchResult = { status: "launched"; queued: number } | { status: "already_started" };

/**
 * Mulai kampanye: hitung anggota segmen yang memenuhi syarat (opt-in, belum
 * unsubscribe, punya alamat channel) dan masukkan ke antrean penerima.
 * Idempoten: pemanggil kedua (mis. scheduler + tombol manual bersamaan)
 * mendapat `already_started`.
 */
export async function launchCampaign(campaignId: string): Promise<LaunchResult> {
  const result = await prisma.$transaction(
    async (tx): Promise<LaunchResult> => {
      const status = await lockCampaign(tx, campaignId);
      if (status !== "DRAFT" && status !== "SCHEDULED") return { status: "already_started" };

      const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { segment: true } });
      const filter = SegmentFilter.parse(campaign.segment.filter);
      const contacts = await tx.contact.findMany({
        where: { AND: [buildContactWhere(filter), eligibleWhere(campaign.channel)] },
        select: { id: true, phone: true, email: true },
      });

      // Dedup per alamat: dua kontak dengan nomor WA sama hanya dikirimi sekali.
      const seen = new Set<string>();
      const rows: Prisma.CampaignRecipientCreateManyInput[] = [];
      for (const c of contacts) {
        const address = addressFor(c, campaign.channel);
        if (!address || seen.has(address)) continue;
        seen.add(address);
        rows.push({ campaignId, contactId: c.id, address });
      }
      const { count } = await tx.campaignRecipient.createMany({ data: rows, skipDuplicates: true });

      await tx.$executeRaw`
        UPDATE campaigns SET status = 'SENDING', "startedAt" = clock_timestamp(), "updatedAt" = clock_timestamp()
        WHERE id = ${campaignId}`;
      return { status: "launched", queued: count };
    },
    { timeout: 30_000 },
  );

  // Pengiriman berjalan di latar belakang; respons API tidak menunggu.
  if (result.status === "launched") void dispatchCampaign(campaignId);
  return result;
}

/** Kampanye yang sedang dikirim oleh proses ini (cegah loop ganda di satu proses). */
const inFlight = new Set<string>();

interface ClaimedRecipient {
  id: string;
  address: string;
  contactName: string;
  contactCity: string | null;
  accountName: string | null;
  accountCity: string | null;
  marketingOptIn: boolean;
  unsubscribedAt: Date | null;
}

/** Kirim seluruh antrean PENDING milik kampanye, batch demi batch. */
export async function dispatchCampaign(campaignId: string): Promise<void> {
  if (inFlight.has(campaignId)) return;
  inFlight.add(campaignId);
  try {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return;

    for (;;) {
      const processed = await prisma.$transaction(
        async (tx) => {
          // Klaim batch: baris yang sedang dikirim proses lain dilewati (SKIP LOCKED).
          // JOIN ke campaigns memastikan kampanye yang dibatalkan langsung berhenti.
          const batch = await tx.$queryRaw<ClaimedRecipient[]>`
            SELECT r.id, r.address, ct.name AS "contactName", ct.city AS "contactCity",
                   a.name AS "accountName", a.city AS "accountCity",
                   ct."marketingOptIn", ct."unsubscribedAt"
            FROM campaign_recipients r
            JOIN campaigns c ON c.id = r."campaignId"
            JOIN contacts ct ON ct.id = r."contactId"
            LEFT JOIN accounts a ON a.id = ct."accountId"
            WHERE r."campaignId" = ${campaignId} AND r.status = 'PENDING' AND c.status = 'SENDING'
            ORDER BY r."createdAt", r.id
            LIMIT ${BATCH_SIZE}
            FOR UPDATE OF r SKIP LOCKED`;

          for (const r of batch) {
            // Consent dicek ulang tepat sebelum kirim: kontak bisa saja
            // membalas STOP setelah antrean dibuat.
            if (!r.marketingOptIn || r.unsubscribedAt) {
              await tx.campaignRecipient.update({
                where: { id: r.id },
                data: { status: "SKIPPED", error: "Kontak sudah berhenti berlangganan" },
              });
              continue;
            }
            const text = renderMessage(campaign.body, campaign.channel, {
              nama: r.contactName,
              perusahaan: r.accountName,
              kota: r.contactCity ?? r.accountCity,
            });
            try {
              await sendMarketingMessage({ channel: campaign.channel, address: r.address, subject: campaign.subject, text });
              await tx.$executeRaw`
                UPDATE campaign_recipients SET status = 'SENT', "sentAt" = clock_timestamp(), error = NULL
                WHERE id = ${r.id}`;
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              await tx.campaignRecipient.update({
                where: { id: r.id },
                data: { status: "FAILED", error: message.slice(0, 500) },
              });
            }
            if (SEND_DELAY_MS > 0) await sleep(SEND_DELAY_MS);
          }
          return batch.length;
        },
        { timeout: 120_000 },
      );
      if (processed === 0) break;
    }

    // Tandai selesai hanya bila benar-benar tidak ada antrean tersisa
    // (proses lain mungkin masih memegang batch terakhir).
    await prisma.$executeRaw`
      UPDATE campaigns SET status = 'SENT', "completedAt" = clock_timestamp(), "updatedAt" = clock_timestamp()
      WHERE id = ${campaignId} AND status = 'SENDING'
        AND NOT EXISTS (
          SELECT 1 FROM campaign_recipients WHERE "campaignId" = ${campaignId} AND status = 'PENDING'
        )`;
  } catch (err) {
    // Antrean tetap PENDING; scheduler akan mencoba lagi pada tick berikutnya.
    console.error(`[campaign ${campaignId}] dispatch gagal`, err);
  } finally {
    inFlight.delete(campaignId);
  }
}

/** Batalkan kampanye. Pesan yang sudah terkirim tidak bisa ditarik kembali. */
export async function cancelCampaign(campaignId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const status = await lockCampaign(tx, campaignId);
    if (status === "SENT" || status === "CANCELLED") {
      throw new HttpError(409, `Kampanye berstatus ${status} tidak bisa dibatalkan`);
    }
    await tx.campaign.update({ where: { id: campaignId }, data: { status: "CANCELLED", completedAt: new Date() } });
    // Menunggu batch yang sedang dikirim selesai (lock baris), lalu sisanya di-skip.
    await tx.campaignRecipient.updateMany({
      where: { campaignId, status: "PENDING" },
      data: { status: "SKIPPED", error: "Kampanye dibatalkan" },
    });
  });
}

/** Satu putaran scheduler: luncurkan yang jatuh tempo & lanjutkan yang terputus. */
export async function runSchedulerTick(): Promise<void> {
  const due = await prisma.campaign.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const c of due) await launchCampaign(c.id);

  const sending = await prisma.campaign.findMany({ where: { status: "SENDING" }, select: { id: true } });
  for (const c of sending) void dispatchCampaign(c.id);
}

export function startCampaignScheduler(): () => void {
  const tick = () => runSchedulerTick().catch((err: unknown) => console.error("[campaign scheduler]", err));
  tick();
  const timer = setInterval(tick, SCHEDULER_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Opt-out lewat chat ("STOP")
// ---------------------------------------------------------------------------

const OPT_OUT_KEYWORDS = new Set(["STOP", "BERHENTI", "UNSUBSCRIBE", "UNREG"]);

/**
 * Bila customer membalas kata kunci berhenti dan nomornya terdaftar sebagai
 * kontak yang opt-in, cabut consent-nya. Mengembalikan jumlah kontak yang
 * di-unsubscribe (0 = bukan permintaan opt-out, lanjutkan alur chat biasa).
 */
export async function handleOptOutKeyword(externalId: string, text: string): Promise<number> {
  if (!OPT_OUT_KEYWORDS.has(text.trim().toUpperCase())) return 0;
  const phone = normalizePhone(externalId);
  if (!phone) return 0;

  // Nomor bisa tersimpan dalam berbagai format; saring kasar di DB (9 digit
  // terakhir), lalu cocokkan pasti setelah normalisasi.
  const candidates = await prisma.contact.findMany({
    where: { phone: { contains: phone.slice(-9) }, marketingOptIn: true, unsubscribedAt: null },
    select: { id: true, phone: true },
  });
  const ids = candidates.filter((c) => normalizePhone(c.phone) === phone).map((c) => c.id);
  if (!ids.length) return 0;

  const { count } = await prisma.contact.updateMany({
    where: { id: { in: ids } },
    data: { marketingOptIn: false, unsubscribedAt: new Date() },
  });
  return count;
}
