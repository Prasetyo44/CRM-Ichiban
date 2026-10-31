// =============================================================================
// LANGKAH 2 — AI AGENT & LOGIKA KUALIFIKASI
// -----------------------------------------------------------------------------
// processIncomingMessage() adalah satu-satunya pintu masuk pesan customer.
// Alur:
//   1. Upsert Lead (berdasarkan externalId channel) & ambil/buat ChatSession aktif.
//   2. Simpan pesan customer.
//   3. Percabangan berdasarkan status sesi:
//        assigned_to_human  -> AI DIAM. Pesan diteruskan real-time ke Sales.
//        pending_assignment -> coba routing ulang (mungkin sales sudah tersedia).
//        ai_qualifying      -> panggil Claude, simpan balasan, update data Lead.
//   4. Claude menentukan segmen (B2B/B2C) + lini produk Ichiban. Jika
//      qualification_complete = true (dan lolos validasi server), panggil
//      assignLeadToSalesSpecialist() -> AI berhenti permanen untuk sesi ini.
// =============================================================================
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MessageSender, type Channel, type ChatSession, type Lead, type Message, type ProductLine } from "@prisma/client";
import { env } from "../../config/env";
import { anthropic } from "../../lib/anthropic";
import { KeyedMutex } from "../../lib/keyed-mutex";
import { prisma } from "../../lib/prisma";
import { emitToAgent } from "../../realtime/socket";
import { toMessageDTO } from "../../types/mappers";
import { assignLeadToSalesSpecialist, type AssignmentResult } from "../routing/routing.service";
import { getActiveProductLines } from "../catalog/catalog.service";
import { QUALIFICATION_RULES, buildCatalogPrompt } from "./qualification.prompt";
import {
  buildQualificationSchema,
  normalizeQualification,
  type QualificationResult,
} from "./qualification.schema";

// ---------------------------------------------------------------------------
// Tipe publik
// ---------------------------------------------------------------------------

/** Payload webhook (simulasi input chat dari WhatsApp/Web widget/dll). */
export interface IncomingMessageInput {
  /** ID unik pengirim di channel asal, mis. nomor WA "62812xxxx". */
  externalId: string;
  text: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  /** Channel asal pesan (default WhatsApp). */
  channel?: Channel;
}

export type ProcessOutcome =
  | { mode: "ai_replied"; sessionId: string; reply: string; qualification: QualificationResult }
  | { mode: "handed_off"; sessionId: string; reply: string; assignment: AssignmentResult }
  | { mode: "forwarded_to_agent"; sessionId: string; agentId: string }
  | { mode: "waiting_for_agent"; sessionId: string; reply: string };

// Pesan cadangan bila Claude gagal/menolak — customer tidak boleh dibiarkan tanpa balasan.
const FALLBACK_REPLY =
  "Terima kasih sudah menghubungi Ichiban. Boleh kami tahu produk apa yang Anda cari, dan apakah untuk kebutuhan pribadi atau usaha?";
const WAITING_REPLY =
  "Terima kasih, data Anda sudah kami terima. Sales Spesialis kami akan segera menghubungi Anda.";

const customerMutex = new KeyedMutex();

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function processIncomingMessage(input: IncomingMessageInput): Promise<ProcessOutcome> {
  // Serialisasi per customer: pesan beruntun dari pengirim yang sama diproses
  // satu per satu (mencegah sesi ganda & pemanggilan Claude paralel).
  return customerMutex.run(input.externalId, async () => {
    const lead = await upsertLead(input);
    const session = await getOrCreateActiveSession(lead.id, input.channel);

    const customerMessage = await prisma.message.create({
      data: { sessionId: session.id, sender: MessageSender.CUSTOMER, content: input.text },
    });
    await touchSession(session.id);

    // Baca ulang status DI DALAM lock (bisa saja baru berubah oleh pesan sebelumnya).
    const fresh = await prisma.chatSession.findUniqueOrThrow({ where: { id: session.id } });

    switch (fresh.status) {
      case "assigned_to_human":
        return forwardToAgent(fresh, customerMessage);
      case "pending_assignment":
        return retryPendingAssignment(fresh, lead);
      case "closed": // hanya terjadi bila sesi ditutup tepat saat pesan masuk
      case "ai_qualifying":
        return runQualificationTurn(fresh.id, lead.id);
    }
  });
}

// ---------------------------------------------------------------------------
// Cabang: AI kualifikasi
// ---------------------------------------------------------------------------

async function runQualificationTurn(sessionId: string, leadId: string): Promise<ProcessOutcome> {
  const [history, catalog] = await Promise.all([
    prisma.message.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } }),
    getActiveProductLines(),
  ]);

  const raw = await callClaude(toClaudeMessages(history), catalog);
  const result = enforceCompletionRules(raw, catalog);
  const productLine = catalog.find((l) => l.code === result.product_line) ?? null;

  // Simpan balasan AI (teks saja, bukan JSON) agar histori tetap natural.
  const aiMessage = await prisma.message.create({
    data: { sessionId, sender: MessageSender.AI, content: result.ai_reply_message },
  });

  // Simpan data parsial setiap giliran — progres kualifikasi tidak hilang.
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      ...(result.customer_type && { customerType: result.customer_type }),
      ...(productLine && { productLineId: productLine.id }),
      ...(result.customer_name && { contactName: result.customer_name }),
      ...(result.city && { city: result.city }),
      ...(result.company_name && { companyName: result.company_name }),
      ...(result.company_scale && { companyScale: result.company_scale }),
      ...(result.business_sector && { businessSector: result.business_sector }),
      ...(result.summary && { aiSummary: result.summary }),
    },
  });

  if (!result.qualification_complete || !productLine || !result.customer_type) {
    return { mode: "ai_replied", sessionId, reply: aiMessage.content, qualification: result };
  }

  // Kualifikasi selesai -> hentikan AI & alihkan ke tim lini produk + segmen terkait.
  await prisma.chatSession.update({ where: { id: sessionId }, data: { qualifiedAt: new Date() } });
  const assignment = await assignLeadToSalesSpecialist(sessionId, {
    productLineCode: productLine.code,
    customerType: result.customer_type,
  });
  return { mode: "handed_off", sessionId, reply: aiMessage.content, assignment };
}

/**
 * Memanggil Claude dengan structured outputs: respons DIJAMIN berbentuk JSON
 * sesuai skema, lalu diparse & dinormalisasi (kode lini produk dicek ke katalog).
 */
async function callClaude(
  messages: Anthropic.Beta.BetaMessageParam[],
  catalog: ProductLine[],
): Promise<QualificationResult> {
  if (messages.length === 0 || catalog.length === 0) return fallbackResult();

  try {
    const response = await anthropic.beta.messages.parse({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 2048,
      // Aturan statis + katalog; breakpoint cache di blok terakhir -> keduanya di-cache.
      system: [
        { type: "text", text: QUALIFICATION_RULES },
        { type: "text", text: buildCatalogPrompt(catalog), cache_control: { type: "ephemeral" } },
      ],
      messages,
      // effort "low": tugas chat kualifikasi sederhana, prioritaskan latensi.
      output_config: { effort: "low", format: betaZodOutputFormat(buildQualificationSchema(catalog.map((l) => l.code))) },
      // Jika safety classifier menolak, API otomatis mengulang di model cadangan.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      console.warn("[ai-agent] Claude tidak mengembalikan JSON valid:", response.stop_reason);
      return fallbackResult();
    }
    return normalizeQualification(response.parsed_output, catalog);
  } catch (error) {
    // Error API (rate limit, jaringan) sudah di-retry SDK; di sini kita degradasi dengan aman.
    console.error("[ai-agent] Gagal memanggil Claude:", error);
    return fallbackResult();
  }
}

/**
 * Validasi sisi server — jangan 100% percaya flag dari LLM.
 * Kualifikasi hanya dianggap selesai bila data wajib segmen benar-benar terisi
 * dan lini produk yang dipilih memang melayani segmen tersebut.
 */
function enforceCompletionRules(result: QualificationResult, catalog: ProductLine[]): QualificationResult {
  const filled = (v: string | null): boolean => Boolean(v?.trim());
  const line = catalog.find((l) => l.code === result.product_line);

  const segmentDataComplete =
    result.customer_type === "B2C"
      ? filled(result.customer_name) && filled(result.city)
      : result.customer_type === "B2B"
        ? filled(result.company_name) && filled(result.company_scale) && filled(result.business_sector)
        : false;

  // Mis. "Ichiban Ink" hanya B2B: B2C yang bertanya tinta tetap diteruskan via
  // fallback routing (lini produk tanpa filter segmen), jadi tidak diblokir di sini.
  const complete = result.qualification_complete && Boolean(line) && segmentDataComplete;

  return { ...result, qualification_complete: complete, summary: complete ? result.summary : null };
}

const fallbackResult = (): QualificationResult => ({
  qualification_complete: false,
  customer_type: null,
  product_line: null,
  customer_name: null,
  city: null,
  company_name: null,
  company_scale: null,
  business_sector: null,
  summary: null,
  ai_reply_message: FALLBACK_REPLY,
});

/**
 * Konversi histori DB -> format Messages API.
 * CUSTOMER -> user, AI -> assistant. Pesan SYSTEM/AGENT tidak dikirim ke AI.
 * Pesan berurutan dengan role sama digabung, dan histori harus diawali "user".
 */
function toClaudeMessages(history: Message[]): Anthropic.Beta.BetaMessageParam[] {
  const result: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of history) {
    const role = m.sender === "CUSTOMER" ? "user" : m.sender === "AI" ? "assistant" : null;
    if (!role) continue;
    const last = result.at(-1);
    if (last && last.role === role) last.content += `\n${m.content}`;
    else if (result.length > 0 || role === "user") result.push({ role, content: m.content });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Cabang: sesi sudah dipegang manusia / menunggu agent
// ---------------------------------------------------------------------------

function forwardToAgent(session: ChatSession, message: Message): ProcessOutcome {
  // AI tidak dipanggil sama sekali — hanya teruskan pesan ke dashboard sales.
  if (session.assignedAgentId) {
    emitToAgent(session.assignedAgentId, "message:new", toMessageDTO(message));
    return { mode: "forwarded_to_agent", sessionId: session.id, agentId: session.assignedAgentId };
  }
  return { mode: "waiting_for_agent", sessionId: session.id, reply: WAITING_REPLY };
}

async function retryPendingAssignment(session: ChatSession, lead: Lead): Promise<ProcessOutcome> {
  const current = await prisma.lead.findUniqueOrThrow({
    where: { id: lead.id },
    include: { productLine: true },
  });
  if (current.productLine && current.customerType) {
    const assignment = await assignLeadToSalesSpecialist(session.id, {
      productLineCode: current.productLine.code,
      customerType: current.customerType,
    });
    if (assignment.status !== "no_agent_available") {
      return { mode: "handed_off", sessionId: session.id, reply: WAITING_REPLY, assignment };
    }
  }
  return { mode: "waiting_for_agent", sessionId: session.id, reply: WAITING_REPLY };
}

// ---------------------------------------------------------------------------
// Helper persistence
// ---------------------------------------------------------------------------

function upsertLead(input: IncomingMessageInput): Promise<Lead> {
  const contact = {
    ...(input.contactName && { contactName: input.contactName }),
    ...(input.contactPhone && { contactPhone: input.contactPhone }),
    ...(input.contactEmail && { contactEmail: input.contactEmail }),
  };
  return prisma.lead.upsert({
    where: { externalId: input.externalId },
    create: { externalId: input.externalId, ...contact },
    update: contact,
  });
}

/** Ambil sesi aktif (bukan closed) milik lead, atau buat sesi baru. */
async function getOrCreateActiveSession(leadId: string, channel: Channel = "WHATSAPP"): Promise<ChatSession> {
  const existing = await prisma.chatSession.findFirst({
    where: { leadId, status: { not: "closed" } },
    orderBy: { createdAt: "desc" },
  });
  return existing ?? prisma.chatSession.create({ data: { leadId, channel } });
}

const touchSession = (sessionId: string) =>
  prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
