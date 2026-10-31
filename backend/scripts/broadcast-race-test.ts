// Uji ketahanan broadcast terhadap pengiriman ganda.
//   MARKETING_SEND_DELAY_MS=150 npx tsx scripts/broadcast-race-test.ts
// Membuat kampanye ke seluruh kontak opt-in, lalu menjalankan BERSAMAAN:
//   - 3x launchCampaign di proses ini (simulasi tombol + scheduler),
//   - 2 proses anak yang menjalankan dispatchCampaign (simulasi 2 instance server).
// Lulus bila setiap alamat menerima tepat satu pesan.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "../src/lib/prisma";
import { dispatchCampaign, launchCampaign } from "../src/modules/marketing/campaign.service";

const run = promisify(execFile);

async function main(): Promise<void> {
  const workerId = process.argv[2] === "--worker" ? process.argv[3] : undefined;
  if (workerId) {
    await dispatchCampaign(workerId);
    return;
  }

  const manager = await prisma.user.findFirstOrThrow({ where: { role: "SALES_MANAGER" } });
  const segment = await prisma.segment.create({
    data: { name: `race-test ${Date.now()}`, filter: { customerStatus: "any" }, createdById: manager.id },
  });
  const campaign = await prisma.campaign.create({
    data: { name: "race-test", channel: "WHATSAPP", segmentId: segment.id, body: "Halo {{nama}}", createdById: manager.id },
  });

  const launches = await Promise.all([1, 2, 3].map(() => launchCampaign(campaign.id)));
  // Proses anak ikut mengirim antrean yang sama saat proses ini masih mengirim.
  const workers = [1, 2].map(() => run("npx", ["tsx", __filename, "--worker", campaign.id], { env: process.env }));
  const outputs = await Promise.all(workers);

  // Tunggu dispatch di proses ini (dipicu launch) selesai.
  for (let i = 0; i < 100; i++) {
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    if (c.status === "SENT") break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId: campaign.id } });
  const sentLines = [...localSends, ...outputs.flatMap((o) => o.stdout.split("\n").filter((l) => l.includes("[broadcast")))];
  const perAddress = new Map<string, number>();
  for (const line of sentLines) {
    const addr = /-> (\S+)\]/.exec(line)?.[1] ?? "?";
    perAddress.set(addr, (perAddress.get(addr) ?? 0) + 1);
  }
  const dupes = [...perAddress].filter(([, n]) => n > 1);

  console.log({
    launches: launches.map((l) => l.status),
    queued: recipients.length,
    sentStatus: recipients.filter((r) => r.status === "SENT").length,
    messagesSent: sentLines.length,
    byProcess: { main: localSends.length, worker1: count(outputs[0]?.stdout), worker2: count(outputs[1]?.stdout) },
    duplicates: dupes.length,
  });
  const ok =
    launches.filter((l) => l.status === "launched").length === 1 &&
    dupes.length === 0 &&
    sentLines.length === recipients.length &&
    recipients.every((r) => r.status === "SENT");
  console.log(ok ? "✅ LULUS: tidak ada pesan ganda" : "❌ GAGAL");
  if (!ok) process.exitCode = 1;

  await prisma.campaign.delete({ where: { id: campaign.id } });
  await prisma.segment.delete({ where: { id: segment.id } });
}

const count = (s?: string) => (s ?? "").split("\n").filter((l) => l.includes("[broadcast")).length;

// Rekam pesan yang dikirim proses utama tanpa mengubah adapter.
const localSends: string[] = [];
if (process.argv[2] !== "--worker") {
  const original = console.info;
  console.info = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.includes("[broadcast")) localSends.push(line);
    else original(...args);
  };
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
