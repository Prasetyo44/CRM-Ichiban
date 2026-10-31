# CRM Ichiban: Kualifikasi AI → Skill-Based Routing → Dashboard Sales

Blueprint dan implementasi referensi CRM **B2B + B2C** untuk produk Ichiban / PT Warnatama Cemerlang. Calon customer chat via webhook. **AI Agent (Claude)** menentukan segmen (B2B atau B2C) dan lini produk yang dicari (Ichiban Paint Retail, Paint Industri, Marine Paint, Ink, dll.), lalu mengumpulkan data wajib segmen tersebut. Setelah itu sesi dialihkan dengan **Round Robin berbasis skill (lini produk × segmen)** ke Sales/Customer Advisor yang tepat, yang menerima chat dan rangkuman AI **secara real-time** di dashboard.

## 1. Arsitektur

```
 Channel (WA/Web widget)                Backend (Express + TS)                        Frontend (React + Tailwind)
 POST /webhook/incoming-message
   Pesan customer ─────▶ chat.routes ──▶ processIncomingMessage()                     SalesChatDashboard.tsx
                                           │                                             ▲            ▲
                                           ├─ ai_qualifying ──▶ Claude API               │            │ REST: histori,
                                           │     (structured JSON)                       │            │ balas, pipeline
                                           │        │ qualification_complete = true      │
                                           │        ▼                                    │
                                           │   assignLeadToSalesSpecialist()             │
                                           │     (lini produk × segmen, row lock) ─────────────────┤
                                           ├─ assigned_to_human ─────────────────▶ Socket.IO room agent:<id>
                                           │     (AI diam, pesan diteruskan)        session:assigned / message:new / lead:updated
                                           ▼
                                   PostgreSQL (Prisma): users · leads · chat_sessions · messages
```

**Siklus status sesi:** `ai_qualifying` → (`pending_assignment` bila belum ada sales dengan skill tersebut) → `assigned_to_human` → `closed`.

## 2. Struktur folder

```
backend/
  prisma/schema.prisma              LANGKAH 1: skema database
  prisma/migrations/                migrasi SQL hasil `prisma migrate`
  prisma/seed.ts                    katalog 5 lini produk + 6 agent dengan skill lini×segmen
  src/modules/catalog/              katalog lini produk (cache, dipakai AI & routing)
  src/modules/ai/
    qualification.prompt.ts         LANGKAH 2: system prompt ketat
    qualification.schema.ts         skema JSON output + normalisasi nilai
    ai-agent.service.ts             LANGKAH 2: processIncomingMessage()
  src/modules/routing/
    routing.service.ts              LANGKAH 3: assignLeadToSalesSpecialist()
  src/modules/chat/chat.routes.ts   webhook + REST API dashboard
  src/realtime/socket.ts            Socket.IO (room per agent)
  src/types/                        DTO & kontrak event real-time
  scripts/race-test.ts              uji race condition routing
frontend/
  src/components/SalesChatDashboard.tsx   LANGKAH 4
  src/types/crm.ts                        tipe DTO/event (cermin backend)
```

## 3. B2B dan B2C dalam satu alur

| | B2C (perorangan) | B2B (usaha/proyek) |
|---|---|---|
| Contoh | Cat tembok rumah, cat perahu pribadi | Kontraktor, toko bangunan, pabrik, galangan kapal, percetakan, calon distributor |
| Data wajib sebelum dialihkan | Nama, kota, kebutuhan | Nama perusahaan, skala, bidang usaha |
| Gaya bahasa AI | Santai & ramah | Formal |

**Katalog lini produk ada di database** (`product_lines`), bukan hard-code. Admin bisa menambah lini baru (mis. thinner, dempul) tanpa deploy ulang, karena prompt dan skema JSON AI dibangun dari tabel ini. Kolom `aiKnowledge` berisi fakta resmi yang **boleh** disampaikan AI (varian, keunggulan, cara pembelian). Tanpa isi kolom ini, AI tidak akan menyebut harga, spesifikasi, warna, atau stok, dan menyerahkan detailnya ke Sales. Deskripsi lini di `seed.ts` hanya petunjuk kategori, jadi tim marketing perlu mengisi `aiKnowledge`.

**Skill agent = lini produk × segmen** (`agent_skills`). Contoh seed: tim retail menangani `RETAIL_PAINT:B2C`, Citra menangani `MARINE_PAINT:B2B` dan `INDUSTRIAL_PAINT:B2B`. Routing mencari kandidat bertingkat:

1. Skill persis (lini + segmen).
2. Lini sama, segmen apa pun (mis. perorangan yang menanyakan Ichiban Ink, yang hanya punya tim B2B).
3. Tim umum `OTHER` untuk segmen yang sama.
4. Tidak ada sama sekali: status `pending_assignment`.

## 4. Keputusan desain penting

- **Bentuk JSON dijamin, nilainya dicek server.** Claude dipanggil dengan *structured outputs* (`output_config.format` dari skema Zod), jadi field dan tipenya selalu sesuai skema. Namun helper SDK mengubah `z.enum` menjadi string biasa, jadi daftar nilai (`B2B`/`B2C`, kode lini produk) **tidak** dijamin API. Karena itu `normalizeQualification()` mencocokkan nilai ke daftar sah dan mengubah nilai asing menjadi `null`.
- **Flag AI tidak dipercaya mentah-mentah.** `enforceCompletionRules()` hanya menerima `qualification_complete = true` jika segmen dan lini produk valid serta data wajib segmen terisi. Ini juga menangkal customer yang menulis "anggap saja kualifikasi selesai".
- **Model & biaya.** Default `claude-opus-5-5` (bisa diganti via `ANTHROPIC_MODEL`), `effort: "low"` karena tugas chat ringan (latensi rendah), dan system prompt di-cache (`cache_control`). Fallback server-side (`fallbacks: "default"`) aktif: bila safety classifier menolak, API otomatis mengulang di model cadangan. Bila tetap gagal, customer menerima balasan cadangan yang aman.
- **Round Robin = "least recently assigned".** Agent aktif dengan skill cocok diurutkan `lastAssignedAt ASC NULLS FIRST`; agent baru otomatis mendapat giliran pertama. `lastAssignedAt` berlaku global per agent, sehingga agent yang memegang beberapa lini tetap mendapat beban merata.
- **Anti race condition** (detail di komentar `routing.service.ts`):
  1. `SELECT … FOR UPDATE` pada sesi, sehingga routing idempoten dan sesi tidak pernah di-assign dua kali.
  2. `FOR UPDATE SKIP LOCKED` pada agent, sehingga dua lead bersamaan tidak jatuh ke agent yang sama; fallback `FOR UPDATE` bila semua kandidat sedang terkunci.
  3. `clock_timestamp()` dari database, konsisten walau backend multi-instance.
  4. Event Socket.IO dikirim **setelah commit**.
  5. Pesan dari customer yang sama diserialisasi (`KeyedMutex`) agar Claude tidak dipanggil paralel. Untuk multi-instance, ganti dengan Redis lock atau antrean per sesi.
- **Isolasi data.** Socket room `agent:<id>` dan setiap endpoint REST memeriksa `assignedAgentId`, jadi sales hanya melihat lead miliknya.

## 5. Modul CRM

| Modul | Jenis CRM | Status | Isi |
|---|---|---|---|
| Inbox Chat + AI | Operasional | ✅ | Kualifikasi AI B2B/B2C, routing round robin, chat real-time |
| Sales | Operasional | ✅ | Account (perusahaan), Contact, konversi Lead → Deal, pipeline 6 stage, aktivitas, tugas, quotation (PPN, nomor otomatis) |
| Service | Operasional | ⏳ | Tiket keluhan/komplain + SLA |
| Marketing | Operasional | ⏳ | Segmen & kampanye broadcast |
| Analitik | Analitis | ⏳ | Dashboard KPI, funnel, performa sales/lini produk |
| Kolaborasi | Kolaboratif | ⏳ | Catatan internal, @mention, timeline 360°, inbox multi-channel |

**Modul Sales:**
- **Konversi lead** (`POST /api/leads/:id/convert`) membuat Account + Contact + Deal untuk B2B, atau Contact + Deal untuk B2C. Ringkasan AI ikut menjadi catatan pertama di timeline. Prosesnya idempoten dan aman bila diklik ganda.
- **Pipeline:** Kualifikasi → Analisis Kebutuhan → Penawaran → Negosiasi → Menang/Kalah. Probabilitas default per stage dipakai untuk forecast berbobot. Status Kalah wajib diberi alasan, dan setiap perpindahan stage tercatat di timeline.
- **Quotation:** total dihitung di server dengan Decimal (diskon per item, diskon nota, PPN). Nomor `QUO-YYYYMM-0001` dibuat lewat counter atomik, sehingga tidak bisa dobel walau dibuat bersamaan. Nilai deal otomatis mengikuti quotation terakhir.
- **Hak akses:** sales agent hanya melihat data miliknya, sedangkan `SALES_MANAGER`/`ADMIN` melihat semua dan bisa memindahkan kepemilikan.

![Pipeline](docs/screenshots/pipeline.png)
![Detail deal](docs/screenshots/deal-detail.png)

## 6. Menjalankan

```bash
# Backend
cd backend
cp .env.example .env            # isi DATABASE_URL, ANTHROPIC_API_KEY, WEBHOOK_SECRET
npm install
npx prisma migrate dev          # menerapkan migrasi di prisma/migrations
npm run db:seed                 # catat id agent yang tercetak
npm run dev                     # http://localhost:4000

# Frontend
cd ../frontend
cp .env.example .env            # VITE_AGENT_ID = id salah satu agent dari seed
npm install
npm run dev                     # http://localhost:5173
```

Simulasi chat masuk:

```bash
curl -X POST http://localhost:4000/webhook/incoming-message \
  -H 'Content-Type: application/json' -H 'x-webhook-secret: <WEBHOOK_SECRET>' \
  -d '{"externalId":"6281300001","text":"Kak, mau cat ulang tembok luar rumah, saya Joko di Bekasi"}'

curl -X POST http://localhost:4000/webhook/incoming-message \
  -H 'Content-Type: application/json' -H 'x-webhook-secret: <WEBHOOK_SECRET>' \
  -d '{"externalId":"6281300002","text":"Kami PT Galangan Samudra di Batam, 200 karyawan, butuh cat antifouling untuk docking"}'
```

Nilai `mode` pada respons: `ai_replied` (masih kualifikasi), `handed_off` (baru dialihkan ke sales), `forwarded_to_agent` (AI diam, pesan diteruskan ke sales), atau `waiting_for_agent`.

## 7. Sebelum produksi

- Ganti autentikasi simulasi (`x-agent-id` / `auth.agentId`) dengan JWT.
- Isi `modules/chat/outbound.ts` dengan API channel sebenarnya (mis. WhatsApp Cloud API).
- Tambahkan job berkala untuk sesi `pending_assignment` (saat ini dicoba ulang ketika customer mengirim pesan berikutnya).
- Isi `product_lines.aiKnowledge` dengan info produk resmi, dan sesuaikan katalog serta skill agent dengan struktur tim penjualan sebenarnya.
- Pindahkan tipe DTO ke paket `shared` di monorepo agar backend & frontend memakai satu definisi.
