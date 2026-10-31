// =============================================================================
// LANGKAH 3 — MESIN ROUTING ROUND ROBIN (skill-based, race-safe)
// -----------------------------------------------------------------------------
// Kunci routing = (lini produk, segmen B2B/B2C). Skill agent disimpan di tabel
// agent_skills, mis. Citra -> (MARINE_PAINT, B2B). Kandidat dicari bertingkat:
//   Tingkat 1: skill persis (lini produk + segmen).
//   Tingkat 2: lini produk sama, segmen apa pun (mis. B2C bertanya Ichiban Ink
//              yang hanya punya tim B2B -> tetap ditangani spesialis Ink).
//   Tingkat 3: tim "OTHER" (umum) untuk segmen yang sama.
//   Tidak ada sama sekali -> status pending_assignment.
//
// Prinsip Round Robin "least recently assigned":
//   Dari semua Sales Agent aktif pada tingkat tersebut, pilih yang
//   `lastAssignedAt`-nya PALING LAMA (NULL = belum pernah dapat lead -> prioritas
//   tertinggi). Setelah dipilih, `lastAssignedAt` di-set ke waktu sekarang
//   sehingga agent tersebut pindah ke ujung antrean. Hasilnya: distribusi adil
//   dan otomatis menyesuaikan saat agent baru ditambahkan atau kembali aktif.
//
// Antisipasi race condition (semua dalam SATU transaksi PostgreSQL):
//   (A) Sesi yang sama di-routing dua kali bersamaan
//       -> `SELECT ... FROM chat_sessions ... FOR UPDATE` mengunci baris sesi.
//          Pemanggil kedua menunggu, lalu melihat status sudah assigned_to_human
//          dan mengembalikan hasil yang sama (idempoten).
//   (B) Dua sesi berbeda (lini produk sama) memilih agent yang sama bersamaan
//       -> `FOR UPDATE SKIP LOCKED` pada baris agent: transaksi kedua otomatis
//          melewati agent yang sedang dikunci dan mengambil agent berikutnya.
//          Jika SEMUA kandidat sedang dikunci, fallback ke `FOR UPDATE` biasa
//          (menunggu) agar tidak salah menyimpulkan "tidak ada agent".
//   (C) `lastAssignedAt` memakai clock_timestamp() dari database, bukan jam
//       server aplikasi — konsisten walau backend berjalan di banyak instance.
// =============================================================================
import { MessageSender, Prisma, type CustomerType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { emitToAgent } from "../../realtime/socket";
import { leadInclude, toMessageDTO, toSessionDTO } from "../../types/mappers";
import { isCustomerType } from "../ai/qualification.schema";

/** Kunci routing: lini produk (kode katalog) + segmen customer. */
export interface RoutingKey {
  productLineCode: string;
  customerType: CustomerType;
}

/** Kode lini produk tim umum, dipakai sebagai fallback tingkat 3. */
const GENERAL_LINE_CODE = "OTHER";

export type AssignmentResult =
  | { status: "assigned"; sessionId: string; agentId: string; agentName: string; tier: 1 | 2 | 3 }
  | { status: "already_assigned"; sessionId: string; agentId: string }
  | { status: "no_agent_available"; sessionId: string; key: RoutingKey };

type Tx = Prisma.TransactionClient;

interface SessionLockRow {
  id: string;
  status: string;
  assignedAgentId: string | null;
}

interface AgentRow {
  id: string;
  name: string;
}

/** Satu tingkat pencarian kandidat. customerType null = segmen apa pun. */
interface CandidateTier {
  tier: 1 | 2 | 3;
  productLineCode: string;
  customerType: CustomerType | null;
}

const buildTiers = ({ productLineCode, customerType }: RoutingKey): CandidateTier[] => {
  const tiers: CandidateTier[] = [
    { tier: 1, productLineCode, customerType },
    { tier: 2, productLineCode, customerType: null },
  ];
  if (productLineCode !== GENERAL_LINE_CODE) {
    tiers.push({ tier: 3, productLineCode: GENERAL_LINE_CODE, customerType });
  }
  return tiers;
};

export async function assignLeadToSalesSpecialist(
  sessionId: string,
  key: RoutingKey,
): Promise<AssignmentResult> {
  // Validasi input di batas modul (nilai ini masuk ke SQL sebagai parameter).
  if (!isCustomerType(key.customerType) || !key.productLineCode.trim()) {
    throw new Error(`Kunci routing tidak valid: ${JSON.stringify(key)}`);
  }

  const result = await prisma.$transaction(
    async (tx) => {
      // (A) Kunci baris sesi.
      const [session] = await tx.$queryRaw<SessionLockRow[]>`
        SELECT id, status::text AS status, "assignedAgentId"
        FROM chat_sessions
        WHERE id = ${sessionId}
        FOR UPDATE`;
      if (!session) throw new Error(`ChatSession ${sessionId} tidak ditemukan`);

      if (session.status === "assigned_to_human" && session.assignedAgentId) {
        return { status: "already_assigned", sessionId, agentId: session.assignedAgentId } as const;
      }

      // (B) Cari agent tingkat demi tingkat, Round Robin di dalam tiap tingkat.
      let picked: { agent: AgentRow; tier: CandidateTier } | null = null;
      for (const tier of buildTiers(key)) {
        const agent = await pickLeastRecentlyAssignedAgent(tx, tier);
        if (agent) {
          picked = { agent, tier };
          break;
        }
      }

      if (!picked) {
        // Tidak ada tim yang bisa menangani -> antrekan; AI tetap berhenti.
        await tx.chatSession.update({
          where: { id: sessionId },
          data: { status: "pending_assignment" },
        });
        return { status: "no_agent_available", sessionId, key } as const;
      }

      const { agent, tier } = picked;

      // (C) Pindahkan agent ke ujung antrean round robin.
      await tx.$executeRaw`
        UPDATE users SET "lastAssignedAt" = clock_timestamp(), "updatedAt" = clock_timestamp()
        WHERE id = ${agent.id}`;

      // Alihkan sesi ke manusia — mulai titik ini AI tidak akan merespons sesi ini.
      await tx.chatSession.update({
        where: { id: sessionId },
        data: { status: "assigned_to_human", assignedAgentId: agent.id, assignedAt: new Date() },
      });
      const line = await tx.productLine.findUnique({ where: { code: key.productLineCode } });
      await tx.message.create({
        data: {
          sessionId,
          sender: MessageSender.SYSTEM,
          content:
            `Sesi dialihkan dari AI ke ${agent.name} (${line?.name ?? key.productLineCode} · ${key.customerType})` +
            (tier.tier > 1 ? ` melalui fallback tingkat ${tier.tier}.` : "."),
        },
      });

      return {
        status: "assigned",
        sessionId,
        agentId: agent.id,
        agentName: agent.name,
        tier: tier.tier,
      } as const;
    },
    // READ COMMITTED + row lock sudah cukup; timeout membatasi lama menunggu lock.
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
  );

  // Notifikasi real-time dikirim SETELAH commit, jadi dashboard tidak pernah
  // menerima data yang kemudian di-rollback.
  if (result.status === "assigned") await notifyAgent(result.agentId, sessionId);

  return result;
}

/**
 * Query inti Round Robin untuk satu tingkat kandidat. Dua tahap:
 *  1. SKIP LOCKED  -> tidak saling tunggu di bawah beban tinggi.
 *  2. FOR UPDATE   -> fallback bila semua kandidat sedang dikunci transaksi lain.
 * `lastAssignedAt` bersifat global per agent (bukan per lini produk), sehingga
 * agent yang memegang beberapa lini tetap mendapat beban kerja yang merata.
 */
async function pickLeastRecentlyAssignedAgent(tx: Tx, tier: CandidateTier): Promise<AgentRow | null> {
  const segmentFilter = tier.customerType
    ? Prisma.sql`AND s."customerType" = ${tier.customerType}::"CustomerType"`
    : Prisma.empty;

  const query = (lockClause: Prisma.Sql) => tx.$queryRaw<AgentRow[]>`
    SELECT u.id, u.name
    FROM users u
    WHERE u.role = 'SALES_AGENT'
      AND u."isActive" = true
      AND EXISTS (
        SELECT 1
        FROM agent_skills s
        JOIN product_lines p ON p.id = s."productLineId"
        WHERE s."agentId" = u.id
          AND p.code = ${tier.productLineCode}
          AND p."isActive" = true
          ${segmentFilter}
      )
    ORDER BY u."lastAssignedAt" ASC NULLS FIRST, u."createdAt" ASC, u.id ASC
    LIMIT 1
    ${lockClause}`;

  const [free] = await query(Prisma.sql`FOR UPDATE OF u SKIP LOCKED`);
  if (free) return free;

  const [waited] = await query(Prisma.sql`FOR UPDATE OF u`);
  return waited ?? null;
}

/** Kirim sesi lengkap (lead + ringkasan AI + histori chat) ke dashboard sales. */
async function notifyAgent(agentId: string, sessionId: string): Promise<void> {
  const session = await prisma.chatSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { lead: { include: leadInclude }, messages: { orderBy: { createdAt: "asc" } } },
  });
  emitToAgent(agentId, "session:assigned", {
    session: toSessionDTO(session),
    messages: session.messages.map(toMessageDTO),
  });
}
