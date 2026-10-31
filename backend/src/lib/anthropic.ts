// Singleton client Anthropic. Kredensial dibaca otomatis dari ANTHROPIC_API_KEY
// (atau profil `ant auth login`). maxRetries menangani 429/5xx secara otomatis.
import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({ maxRetries: 3, timeout: 60_000 });
