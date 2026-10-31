// =============================================================================
// HTTP API
//   POST  /webhook/incoming-message      <- simulasi pesan customer masuk
//   GET   /api/sessions                  <- daftar chat milik sales (sidebar kiri)
//   GET   /api/sessions/:id/messages     <- histori chat (kolom tengah)
//   POST  /api/sessions/:id/messages     <- sales membalas customer
//   PATCH /api/leads/:id/pipeline        <- update status pipeline (sidebar kanan)
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { PipelineStage } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env";
import { currentUser, requireAgent } from "../../lib/auth";
import { HttpError } from "../../lib/http-error";
import { prisma } from "../../lib/prisma";
import { emitToAgent } from "../../realtime/socket";
import { leadInclude, toLeadDTO, toMessageDTO, toSessionDTO } from "../../types/mappers";
import { processIncomingMessage } from "../ai/ai-agent.service";
import { sendToCustomer } from "./outbound";

export const chatRouter = Router();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function verifyWebhookSecret(req: Request, _res: Response, next: NextFunction): void {
  const given = Buffer.from(req.header("x-webhook-secret") ?? "");
  const expected = Buffer.from(env.WEBHOOK_SECRET);
  const ok = given.length === expected.length && timingSafeEqual(given, expected);
  next(ok ? undefined : new HttpError(401, "Webhook secret tidak valid"));
}

const agentIdOf = (res: Response): string => currentUser(res).id;

/** Pastikan sesi memang milik agent yang login (cegah akses data lead orang lain). */
async function loadOwnedSession(sessionId: string, agentId: string) {
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, assignedAgentId: agentId },
    include: { lead: { include: leadInclude } },
  });
  if (!session) throw new HttpError(404, "Sesi tidak ditemukan");
  return session;
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

const IncomingSchema = z.object({
  externalId: z.string().min(1).max(128),
  text: z.string().trim().min(1).max(4000),
  contactName: z.string().max(200).optional(),
  contactPhone: z.string().max(50).optional(),
  contactEmail: z.email().optional(),
});

chatRouter.post("/webhook/incoming-message", verifyWebhookSecret, async (req, res) => {
  const input = IncomingSchema.parse(req.body);
  const outcome = await processIncomingMessage(input);

  // Balasan AI / auto-reply dikirim balik ke channel customer.
  if ("reply" in outcome) await sendToCustomer(input.externalId, outcome.reply);

  res.json(outcome);
});

// ---------------------------------------------------------------------------
// API Dashboard Sales
// ---------------------------------------------------------------------------

chatRouter.get("/api/sessions", requireAgent, async (_req, res) => {
  const sessions = await prisma.chatSession.findMany({
    where: { assignedAgentId: agentIdOf(res), status: { in: ["assigned_to_human", "closed"] } },
    orderBy: { updatedAt: "desc" },
    include: { lead: { include: leadInclude }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  res.json(sessions.map(toSessionDTO));
});

chatRouter.get("/api/sessions/:id/messages", requireAgent, async (req, res) => {
  const session = await loadOwnedSession(String(req.params.id), agentIdOf(res));
  const messages = await prisma.message.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
  });
  res.json(messages.map(toMessageDTO));
});

const ReplySchema = z.object({ content: z.string().trim().min(1).max(4000) });

chatRouter.post("/api/sessions/:id/messages", requireAgent, async (req, res) => {
  const agentId = agentIdOf(res);
  const { content } = ReplySchema.parse(req.body);
  const session = await loadOwnedSession(String(req.params.id), agentId);
  if (session.status !== "assigned_to_human") throw new HttpError(409, "Sesi sudah ditutup");

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { sessionId: session.id, sender: "AGENT", authorId: agentId, content },
    }),
    prisma.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } }),
  ]);

  await sendToCustomer(session.lead.externalId, content);
  // Sinkronkan tab dashboard lain milik agent yang sama.
  emitToAgent(agentId, "message:new", toMessageDTO(message));
  res.status(201).json(toMessageDTO(message));
});

const PipelineSchema = z.object({ stage: z.enum(PipelineStage) });

chatRouter.patch("/api/leads/:id/pipeline", requireAgent, async (req, res) => {
  const agentId = agentIdOf(res);
  const { stage } = PipelineSchema.parse(req.body);

  // Sales hanya boleh mengubah lead yang sesinya ia pegang.
  const owns = await prisma.chatSession.findFirst({
    where: { leadId: String(req.params.id), assignedAgentId: agentId },
    select: { id: true },
  });
  if (!owns) throw new HttpError(404, "Lead tidak ditemukan");

  const lead = await prisma.lead.update({
    where: { id: String(req.params.id) },
    data: { pipelineStage: stage },
    include: leadInclude,
  });
  emitToAgent(agentId, "lead:updated", toLeadDTO(lead));
  res.json(toLeadDTO(lead));
});
