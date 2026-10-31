// Validasi environment variable sekali saat boot, supaya error konfigurasi
// langsung terlihat (fail fast) dan seluruh kode memakai nilai yang sudah bertipe.
import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  WEBHOOK_SECRET: z.string().min(8),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
