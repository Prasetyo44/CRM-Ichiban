// =============================================================================
// Real-time delivery (Socket.IO)
// -----------------------------------------------------------------------------
// Setiap Sales Agent yang membuka dashboard bergabung ke room `agent:<id>`.
// Backend cukup memanggil helper emitToAgent(...) dan hanya agent pemilik sesi
// yang menerima event — data lead tidak bocor ke sales lain.
// =============================================================================
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { prisma } from "../lib/prisma";
import type { ClientToServerEvents, ServerToClientEvents } from "../types/realtime";

type CrmServer = Server<ClientToServerEvents, ServerToClientEvents>;

let io: CrmServer | null = null;

const agentRoom = (agentId: string): string => `agent:${agentId}`;

export function initSocket(httpServer: HttpServer, corsOrigin: string): CrmServer {
  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: corsOrigin },
  });

  // Autentikasi handshake.
  // CATATAN PRODUKSI: ganti `agentId` polos dengan JWT dan verifikasi tanda
  // tangannya di sini. Versi ini hanya memastikan agent ada & aktif.
  io.use(async (socket, next) => {
    const agentId: unknown = socket.handshake.auth?.agentId;
    if (typeof agentId !== "string" || agentId.length === 0) {
      return next(new Error("agentId wajib dikirim pada handshake"));
    }
    const agent = await prisma.user.findFirst({ where: { id: agentId, isActive: true } });
    if (!agent) return next(new Error("Agent tidak ditemukan / non-aktif"));
    socket.data.agentId = agent.id;
    next();
  });

  io.on("connection", (socket) => {
    const agentId = socket.data.agentId as string;
    void socket.join(agentRoom(agentId));
  });

  return io;
}

/** Kirim event bertipe ke semua tab dashboard milik satu agent. */
export function emitToAgent<E extends keyof ServerToClientEvents>(
  agentId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void {
  if (!io) return; // mis. saat unit test tanpa server socket
  io.to(agentRoom(agentId)).emit(event, ...args);
}
