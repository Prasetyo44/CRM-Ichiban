// Data contoh untuk mencoba dashboard Analitik (jalankan setelah db:seed):
//   npx tsx scripts/demo-data.ts
// Membuat lead, deal (terbuka/menang/kalah), dan tiket acak dalam 60 hari terakhir.
import { CustomerType, DealStage, TicketPriority } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { computeDueDates } from "../src/modules/service/sla";

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function main(): Promise<void> {
  const agents = await prisma.user.findMany({ where: { role: "SALES_AGENT" }, include: { skills: true } });
  const lines = await prisma.productLine.findMany();
  if (!agents.length || !lines.length) throw new Error("Jalankan `npm run db:seed` dulu");

  for (let i = 0; i < 80; i++) {
    const agent = pick(agents);
    const skill = pick(agent.skills);
    const line = lines.find((l) => l.id === skill?.productLineId) ?? pick(lines);
    const segment: CustomerType = skill?.customerType ?? "B2B";
    const created = daysAgo(Math.random() * 60);
    const qualified = Math.random() < 0.8;

    const lead = await prisma.lead.create({
      data: {
        externalId: `demo-${Date.now()}-${i}`,
        customerType: qualified ? segment : null,
        productLineId: qualified ? line.id : null,
        contactName: `Customer Demo ${i + 1}`,
        companyName: segment === "B2B" ? `PT Demo ${i + 1}` : null,
        createdAt: created,
        sessions: {
          create: {
            status: qualified ? "assigned_to_human" : "ai_qualifying",
            assignedAgentId: qualified ? agent.id : null,
            qualifiedAt: qualified ? created : null,
            createdAt: created,
          },
        },
      },
    });
    if (!qualified || Math.random() < 0.3) continue;

    const stage: DealStage = pick(["QUALIFICATION", "NEEDS_ANALYSIS", "PROPOSAL", "NEGOTIATION", "WON", "WON", "LOST"]);
    const closed = stage === "WON" || stage === "LOST";
    const amount = Math.round((segment === "B2B" ? 5e6 + Math.random() * 120e6 : 3e5 + Math.random() * 4e6) / 1000) * 1000;
    await prisma.deal.create({
      data: {
        title: `${line.name} — ${lead.companyName ?? lead.contactName}`,
        customerType: segment,
        stage,
        amount,
        probability: { QUALIFICATION: 10, NEEDS_ANALYSIS: 25, PROPOSAL: 50, NEGOTIATION: 75, WON: 100, LOST: 0 }[stage],
        lostReason: stage === "LOST" ? pick(["Harga", "Pilih kompetitor", "Proyek ditunda"]) : null,
        closedAt: closed ? new Date(created.getTime() + Math.random() * 20 * 86_400_000) : null,
        leadId: lead.id,
        productLineId: line.id,
        ownerId: agent.id,
        createdAt: created,
      },
    });
    await prisma.lead.update({ where: { id: lead.id }, data: { convertedAt: created } });
  }

  for (let i = 0; i < 25; i++) {
    const created = daysAgo(Math.random() * 30);
    const priority: TicketPriority = pick(["LOW", "NORMAL", "NORMAL", "HIGH", "URGENT"]);
    const due = computeDueDates(priority, created);
    const responded = Math.random() < 0.85 ? new Date(created.getTime() + Math.random() * 10 * 3_600_000) : null;
    const resolved = responded && Math.random() < 0.6 ? new Date(created.getTime() + Math.random() * 90 * 3_600_000) : null;
    const agent = pick(agents);
    await prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ value: number }[]>`
        INSERT INTO counters (key, value) VALUES ('TKT-DEMO', 1)
        ON CONFLICT (key) DO UPDATE SET value = counters.value + 1 RETURNING value`;
      await tx.ticket.create({
        data: {
          number: `TKT-DEMO-${String(row?.value ?? i).padStart(4, "0")}`,
          subject: pick(["Warna tidak sesuai katalog", "Cat mengelupas", "Pengiriman terlambat", "Cara aplikasi primer"]),
          description: "Data contoh",
          category: pick(["PRODUCT_QUALITY", "DELIVERY", "TECHNICAL_SUPPORT"] as const),
          priority,
          status: resolved ? "RESOLVED" : responded ? "IN_PROGRESS" : "OPEN",
          assigneeId: agent.id,
          createdById: agent.id,
          createdAt: created,
          firstRespondedAt: responded,
          resolvedAt: resolved,
          ...due,
        },
      });
    });
  }
  console.log("Data contoh dibuat.");
  await prisma.$disconnect();
}
void main();
