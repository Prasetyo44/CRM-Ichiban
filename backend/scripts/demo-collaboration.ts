// Data contoh untuk Timeline 360° (jalankan setelah demo-data & demo-marketing):
//   npx tsx scripts/demo-collaboration.ts
// Melengkapi beberapa account B2B dengan percakapan chat, aktivitas, dan tugas
// agar timeline terlihat seperti riwayat customer sungguhan.
import { prisma } from "../src/lib/prisma";

const hoursAfter = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

async function main(): Promise<void> {
  const deals = await prisma.deal.findMany({
    where: { accountId: { not: null }, leadId: { not: null } },
    take: 8,
    include: { lead: { include: { sessions: true } }, account: true },
  });
  for (const deal of deals) {
    const session = deal.lead?.sessions[0];
    const start = deal.createdAt;
    if (session) {
      await prisma.lead.update({
        where: { id: deal.leadId! },
        data: {
          accountId: deal.accountId,
          aiSummary: `${deal.account?.name ?? "Customer"} butuh ${deal.title.split(" — ")[0]} untuk proyek di ${deal.account?.city ?? "kota mereka"}; minta penawaran harga volume.`,
        },
      });
      await prisma.message.createMany({
        data: [
          { sessionId: session.id, sender: "CUSTOMER", content: "Halo, kami butuh cat untuk proyek, bisa minta info harga?", createdAt: start },
          { sessionId: session.id, sender: "AI", content: "Tentu! Boleh tahu nama perusahaan, skala, dan bidang usahanya?", createdAt: hoursAfter(start, 0.01) },
          { sessionId: session.id, sender: "CUSTOMER", content: `${deal.account?.name}, ${deal.account?.businessSector ?? "kontraktor"}, sekitar 100 karyawan.`, createdAt: hoursAfter(start, 0.05) },
          { sessionId: session.id, sender: "AGENT", authorId: deal.ownerId, content: "Terima kasih, saya siapkan penawarannya hari ini.", createdAt: hoursAfter(start, 1) },
        ],
      });
    }
    await prisma.activity.create({
      data: {
        type: "CALL",
        subject: "Telepon follow-up kebutuhan & jadwal proyek",
        notes: "Customer minta sampel warna dan jadwal kirim sebelum akhir bulan.",
        occurredAt: hoursAfter(start, 26),
        authorId: deal.ownerId,
        dealId: deal.id,
        accountId: deal.accountId,
      },
    });
    await prisma.task.create({
      data: {
        title: "Kirim sampel warna ke customer",
        dueAt: hoursAfter(start, 72),
        status: "DONE",
        completedAt: hoursAfter(start, 50),
        assigneeId: deal.ownerId,
        createdById: deal.ownerId,
        dealId: deal.id,
        accountId: deal.accountId,
        createdAt: hoursAfter(start, 26.5),
      },
    });
  }
  console.info(`Selesai: ${deals.length} account dilengkapi chat, aktivitas, dan tugas.`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
