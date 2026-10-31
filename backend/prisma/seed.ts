// Seed data: katalog lini produk Ichiban + Sales Agent dengan skill (lini produk x segmen).
//
// PENTING: deskripsi di bawah hanya PETUNJUK KATEGORI agar AI bisa mengenali
// lini produk dari pertanyaan customer. Fakta produk resmi (varian, spesifikasi,
// harga, dealer) diisi tim marketing di kolom `aiKnowledge`, karena AI hanya boleh
// menyampaikan fakta dari kolom tersebut.
import { CustomerType, PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();
const { B2B, B2C } = CustomerType;

const productLines = [
  {
    code: "RETAIL_PAINT",
    name: "Ichiban Paint Retail",
    description:
      "Cat dekoratif untuk rumah & bangunan (tembok interior/eksterior, kayu, besi) yang dibeli eceran di toko bangunan; juga kontraktor/toko yang membeli dalam jumlah besar.",
    segments: [B2C, B2B],
  },
  {
    code: "INDUSTRIAL_PAINT",
    name: "Ichiban Paint Industri",
    description:
      "Cat & coating industri untuk pabrik, struktur baja, mesin, tangki, lantai industri, dan proyek konstruksi.",
    segments: [B2B],
  },
  {
    code: "MARINE_PAINT",
    name: "Ichiban Marine Paint",
    description:
      "Cat kapal & lingkungan laut: lambung, antifouling, dek, galangan kapal; juga pemilik perahu perorangan.",
    segments: [B2B, B2C],
  },
  {
    code: "INK",
    name: "Ichiban Ink",
    description: "Tinta untuk percetakan, kemasan, dan kebutuhan industri cetak.",
    segments: [B2B],
  },
  {
    code: "OTHER",
    name: "Produk lain PT Warnatama Cemerlang",
    description:
      "Pertanyaan umum tentang perusahaan, keagenan/distributor, atau produk yang tidak termasuk lini di atas.",
    segments: [B2B, B2C],
  },
] as const;

/** Skill ditulis sebagai "KODE_LINI:SEGMEN" agar ringkas dibaca. */
const agents: { email: string; name: string; skills: `${string}:${CustomerType}`[] }[] = [
  { email: "andi@ichiban.id", name: "Andi Pratama", skills: ["RETAIL_PAINT:B2C", "OTHER:B2C"] },
  { email: "budi@ichiban.id", name: "Budi Santoso", skills: ["RETAIL_PAINT:B2C", "MARINE_PAINT:B2C"] },
  { email: "citra@ichiban.id", name: "Citra Lestari", skills: ["MARINE_PAINT:B2B", "INDUSTRIAL_PAINT:B2B"] },
  { email: "dewi@ichiban.id", name: "Dewi Anggraini", skills: ["INDUSTRIAL_PAINT:B2B", "RETAIL_PAINT:B2B"] },
  { email: "eko@ichiban.id", name: "Eko Wijaya", skills: ["INK:B2B", "INDUSTRIAL_PAINT:B2B"] },
  { email: "fajar@ichiban.id", name: "Fajar Nugroho", skills: ["MARINE_PAINT:B2B", "OTHER:B2B"] },
];

async function main(): Promise<void> {
  const lineIdByCode = new Map<string, string>();
  for (const [index, line] of productLines.entries()) {
    const data = { ...line, segments: [...line.segments], sortOrder: index };
    const saved = await prisma.productLine.upsert({ where: { code: line.code }, update: data, create: data });
    lineIdByCode.set(saved.code, saved.id);
  }

  await prisma.user.upsert({
    where: { email: "manager@ichiban.id" },
    update: {},
    create: { email: "manager@ichiban.id", name: "Sales Manager", role: UserRole.SALES_MANAGER },
  });

  for (const a of agents) {
    const user = await prisma.user.upsert({
      where: { email: a.email },
      update: { name: a.name },
      create: { email: a.email, name: a.name, role: UserRole.SALES_AGENT },
    });
    // Sinkronkan skill: hapus lalu tulis ulang (seed idempoten).
    await prisma.agentSkill.deleteMany({ where: { agentId: user.id } });
    await prisma.agentSkill.createMany({
      data: a.skills.map((skill) => {
        const [code, segment] = skill.split(":") as [string, CustomerType];
        const productLineId = lineIdByCode.get(code);
        if (!productLineId) throw new Error(`Lini produk ${code} tidak ada`);
        return { agentId: user.id, productLineId, customerType: segment };
      }),
    });
    console.info(`Agent ${user.name} -> id ${user.id} | ${a.skills.join(", ")}`);
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
