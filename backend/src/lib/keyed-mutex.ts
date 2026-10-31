// Mutex per-key (in-process). Menjamin pesan-pesan dari SESI YANG SAMA diproses
// berurutan: jika customer mengirim 3 pesan beruntun dalam 1 detik, Claude tidak
// dipanggil paralel dengan histori yang saling tumpang tindih.
//
// CATATAN SKALA: untuk >1 instance backend, ganti dengan lock terdistribusi
// (mis. Redis Redlock atau pg_advisory_lock) atau antrean per-sesi (BullMQ).
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    // Jalankan task setelah task sebelumnya selesai (berhasil ataupun gagal).
    const current = previous.catch(() => undefined).then(task);
    this.tails.set(key, current);
    try {
      return await current;
    } finally {
      // Bersihkan map bila tidak ada task baru yang mengantre di belakang kita.
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}
