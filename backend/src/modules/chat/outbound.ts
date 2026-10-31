// Adapter pengiriman pesan ke channel customer (WhatsApp, Web widget, dll).
// Versi simulasi hanya mencatat log; ganti isinya dengan API channel sebenarnya.
export async function sendToCustomer(externalId: string, text: string): Promise<void> {
  console.info(`[outbound -> ${externalId}] ${text}`);
}
