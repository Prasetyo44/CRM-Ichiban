// Pemeriksaan cepat kebijakan SLA (jalankan: npx tsx scripts/sla-check.ts).
import assert from "node:assert/strict";
import { computeDueDates, ticketSla } from "../src/modules/service/sla";

const t0 = new Date("2026-10-31T00:00:00Z");
const h = (n: number) => new Date(t0.getTime() + n * 3600_000);
const due = computeDueDates("HIGH", t0); // 4 jam / 24 jam
const base = { createdAt: t0, ...due, firstRespondedAt: null, resolvedAt: null };

assert.equal(ticketSla(base, h(1)).firstResponse, "on_track");
assert.equal(ticketSla(base, h(3.5)).firstResponse, "at_risk");
assert.equal(ticketSla(base, h(5)).firstResponse, "breached");
assert.equal(ticketSla({ ...base, firstRespondedAt: h(2) }, h(30)).firstResponse, "met");
assert.equal(ticketSla({ ...base, resolvedAt: h(30) }, h(31)).resolution, "breached");
console.log("SLA OK");
