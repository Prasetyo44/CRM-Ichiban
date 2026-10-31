// Uji race condition & fallback routing.
//  - 30 sesi (INDUSTRIAL_PAINT, B2B) di-assign PARALEL, tiap sesi dipanggil 2x
//    bersamaan (uji idempotensi + pemerataan Round Robin).
//  - 1 sesi B2C yang menanyakan INK (tim INK hanya B2B) -> harus jatuh ke tingkat 2.
import { prisma } from "../src/lib/prisma";
import { assignLeadToSalesSpecialist, type RoutingKey } from "../src/modules/routing/routing.service";

async function newSession(tag: string): Promise<string> {
  const lead = await prisma.lead.create({ data: { externalId: `race-${tag}-${Date.now()}-${Math.random()}` } });
  return (await prisma.chatSession.create({ data: { leadId: lead.id } })).id;
}

async function main(): Promise<void> {
  const key: RoutingKey = { productLineCode: "INDUSTRIAL_PAINT", customerType: "B2B" };
  const ids = await Promise.all(Array.from({ length: 30 }, (_, i) => newSession(String(i))));
  const results = await Promise.all(
    ids.flatMap((id) => [assignLeadToSalesSpecialist(id, key), assignLeadToSalesSpecialist(id, key)]),
  );

  const tally: Record<string, number> = {};
  for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
  console.log("status:", tally);

  const users = await prisma.user.findMany();
  const perAgent = await prisma.chatSession.groupBy({ by: ["assignedAgentId"], where: { id: { in: ids } }, _count: true });
  console.log("pembagian:", perAgent.map((p) => `${users.find((u) => u.id === p.assignedAgentId)?.name}: ${p._count}`));
  console.log("pesan sistem (harus 30):", await prisma.message.count({ where: { sessionId: { in: ids }, sender: "SYSTEM" } }));

  const inkB2C = await assignLeadToSalesSpecialist(await newSession("ink"), { productLineCode: "INK", customerType: "B2C" });
  console.log("INK + B2C:", inkB2C);
  await prisma.$disconnect();
}
void main();
