// Data contoh untuk modul Marketing (jalankan setelah scripts/demo-data.ts):
//   npx tsx scripts/demo-marketing.ts
// Membuat Account + Contact untuk setiap deal demo yang belum punya kontak,
// dengan ~70% kontak sudah opt-in marketing, lalu dua segmen contoh.
import { prisma } from "../src/lib/prisma";

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;
const CITIES = ["Jakarta", "Surabaya", "Batam", "Semarang", "Medan", "Makassar", "Bandung"] as const;
const SECTORS: Record<string, readonly string[]> = {
  MARINE_PAINT: ["Galangan kapal", "Perikanan"],
  INDUSTRIAL_PAINT: ["Pabrik baja", "Kontraktor", "Pabrik furnitur"],
  INK: ["Percetakan kemasan", "Percetakan komersial"],
  RETAIL_PAINT: ["Toko bangunan", "Kontraktor"],
  OTHER: ["Distributor"],
};

async function main(): Promise<void> {
  const manager = await prisma.user.findFirst({ where: { role: "SALES_MANAGER" } });
  if (!manager) throw new Error("Jalankan `npm run db:seed` dulu");
  const deals = await prisma.deal.findMany({ where: { contactId: null }, include: { lead: true, productLine: true } });
  if (!deals.length) throw new Error("Tidak ada deal tanpa kontak — jalankan scripts/demo-data.ts dulu");

  let n = 0;
  for (const deal of deals) {
    n++;
    const city = pick(CITIES);
    const name = deal.lead?.contactName ?? `Kontak Demo ${n}`;
    const optIn = Math.random() < 0.7;
    const account =
      deal.customerType === "B2B"
        ? await prisma.account.create({
            data: {
              name: deal.lead?.companyName ?? `PT Demo ${n}`,
              customerType: "B2B",
              businessSector: pick(SECTORS[deal.productLine?.code ?? "OTHER"] ?? ["Distributor"]),
              city,
              ownerId: deal.ownerId,
            },
          })
        : null;
    const contact = await prisma.contact.create({
      data: {
        name,
        accountId: account?.id,
        phone: `0812${String(10_000_000 + n * 7919).slice(0, 8)}`,
        email: Math.random() < 0.6 ? `demo${n}@contoh.id` : null,
        city: account ? null : city,
        ownerId: deal.ownerId,
        marketingOptIn: optIn,
        marketingOptInAt: optIn ? deal.createdAt : null,
      },
    });
    await prisma.deal.update({ where: { id: deal.id }, data: { contactId: contact.id, accountId: account?.id } });
  }

  await prisma.segment.createMany({
    data: [
      {
        name: "Galangan kapal (B2B Marine)",
        description: "Pelanggan & prospek Marine Paint di sektor galangan",
        filter: { customerType: "B2B", productLineCodes: ["MARINE_PAINT"], customerStatus: "any" },
        createdById: manager.id,
      },
      {
        name: "Pembeli retail yang sudah pernah beli",
        description: "B2C dengan deal WON — target repeat order & promo musiman",
        filter: { customerType: "B2C", customerStatus: "customer" },
        createdById: manager.id,
      },
    ],
  });
  console.info(`Selesai: ${deals.length} kontak demo + 2 segmen contoh.`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
