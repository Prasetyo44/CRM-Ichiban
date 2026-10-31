// Bootstrap: Express (REST + webhook) dan Socket.IO berbagi satu HTTP server.
import { createServer } from "node:http";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { chatRouter, HttpError } from "./modules/chat/chat.routes";
import { initSocket } from "./realtime/socket";

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
app.use(chatRouter);

// Error handler terpusat (Express 5 meneruskan error async secara otomatis).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Payload tidak valid", issues: err.issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Terjadi kesalahan internal" });
});

const httpServer = createServer(app);
initSocket(httpServer, env.CORS_ORIGIN);

httpServer.listen(env.PORT, () => {
  console.info(`CRM Ichiban backend berjalan di http://localhost:${env.PORT}`);
});

// Graceful shutdown: tutup koneksi DB saat proses dihentikan.
const shutdown = async (): Promise<void> => {
  httpServer.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
