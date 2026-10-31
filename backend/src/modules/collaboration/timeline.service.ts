// =============================================================================
// Timeline 360° customer: satu urutan waktu yang menggabungkan SEMUA titik
// sentuh dari setiap modul — chat (AI & sales), deal, aktivitas, tugas,
// quotation, tiket & balasannya, kampanye marketing yang diterima, serta
// catatan internal tim.
//
// Cakupan per entitas:
//   ACCOUNT : semua kontak, deal, lead, dan tiket milik perusahaan tsb.
//   CONTACT : deal, lead, tiket, dan kampanye milik kontak tsb.
//   DEAL    : aktivitas, tugas, quotation, tiket, dan chat asal deal tsb.
//   TICKET  : pembuatan tiket, balasan, dan catatan.
// =============================================================================
import type { Channel, EntityType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export type TimelineKind =
  | "chat"
  | "deal"
  | "activity"
  | "task"
  | "quotation"
  | "ticket"
  | "ticket_comment"
  | "campaign"
  | "note";

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  at: string; // ISO-8601
  title: string;
  detail: string | null;
  actor: string | null;
  /** Entitas yang bisa dibuka dari event ini (mis. deal / tiket terkait). */
  link: { type: EntityType; id: string } | null;
}

const CHANNEL_LABEL: Record<Channel, string> = {
  WHATSAPP: "WhatsApp",
  WEB_CHAT: "Web chat",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  EMAIL: "Email",
};

const LIMIT_PER_SOURCE = 200;
const MAX_EVENTS = 400;

const idr = (v: Prisma.Decimal | number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(v));

interface Scope {
  contactIds: string[];
  dealIds: string[];
  leadIds: string[];
  ticketIds: string[];
  accountId: string | null;
  /** Pasangan (type, id) yang catatannya ikut ditampilkan. */
  noteTargets: { entityType: EntityType; entityId: string }[];
}

/** Kumpulkan id semua data yang terkait dengan entitas. */
async function resolveScope(type: EntityType, id: string): Promise<Scope> {
  if (type === "TICKET") {
    return { contactIds: [], dealIds: [], leadIds: [], ticketIds: [id], accountId: null, noteTargets: [{ entityType: "TICKET", entityId: id }] };
  }

  let accountId: string | null = null;
  let contactIds: string[] = [];
  let deals: { id: string; leadId: string | null }[] = [];
  let leadIds: string[] = [];

  if (type === "ACCOUNT") {
    accountId = id;
    contactIds = (await prisma.contact.findMany({ where: { accountId: id }, select: { id: true } })).map((c) => c.id);
    deals = await prisma.deal.findMany({ where: { accountId: id }, select: { id: true, leadId: true } });
    leadIds = (await prisma.lead.findMany({ where: { accountId: id }, select: { id: true } })).map((l) => l.id);
  } else if (type === "CONTACT") {
    contactIds = [id];
    deals = await prisma.deal.findMany({ where: { contactId: id }, select: { id: true, leadId: true } });
    leadIds = (await prisma.lead.findMany({ where: { contactId: id }, select: { id: true } })).map((l) => l.id);
  } else {
    deals = await prisma.deal.findMany({ where: { id }, select: { id: true, leadId: true } });
  }

  const dealIds = deals.map((d) => d.id);
  leadIds = [...new Set([...leadIds, ...deals.map((d) => d.leadId).filter((x): x is string => !!x)])];
  const ticketIds = (
    await prisma.ticket.findMany({
      where: {
        OR: [
          ...(accountId ? [{ accountId }] : []),
          ...(contactIds.length ? [{ contactId: { in: contactIds } }] : []),
          ...(dealIds.length ? [{ dealId: { in: dealIds } }] : []),
        ],
      },
      select: { id: true },
    })
  ).map((t) => t.id);

  const noteTargets = [
    ...(accountId ? [{ entityType: "ACCOUNT" as const, entityId: accountId }] : []),
    ...contactIds.map((entityId) => ({ entityType: "CONTACT" as const, entityId })),
    ...dealIds.map((entityId) => ({ entityType: "DEAL" as const, entityId })),
    ...ticketIds.map((entityId) => ({ entityType: "TICKET" as const, entityId })),
  ];
  // Untuk DEAL, tiket terkait dihitung tetapi kontak/account tidak (fokus ke deal).
  return { contactIds: type === "DEAL" ? [] : contactIds, dealIds, leadIds, ticketIds, accountId, noteTargets };
}

/** Bangun timeline gabungan, terbaru di atas. */
export async function buildTimeline(type: EntityType, id: string): Promise<TimelineEvent[]> {
  const s = await resolveScope(type, id);
  const none = ["__none__"]; // `in: []` aman di Prisma, tapi ini membuat niat lebih jelas di log SQL

  // Bentuk filter yang sama dipakai untuk Activity & Task (kolom relasinya identik).
  const crmLinks: { accountId?: string; contactId?: { in: string[] }; dealId?: { in: string[] } }[] = [
    ...(s.accountId ? [{ accountId: s.accountId }] : []),
    ...(s.contactIds.length ? [{ contactId: { in: s.contactIds } }] : []),
    ...(s.dealIds.length ? [{ dealId: { in: s.dealIds } }] : []),
  ];

  const [sessions, deals, activities, tasks, quotations, tickets, comments, campaigns, notes] = await Promise.all([
    prisma.chatSession.findMany({
      where: { leadId: { in: s.leadIds.length ? s.leadIds : none } },
      take: LIMIT_PER_SOURCE,
      include: {
        lead: { select: { aiSummary: true, contactName: true } },
        assignedAgent: { select: { name: true } },
        _count: { select: { messages: true } },
      },
    }),
    type === "TICKET"
      ? []
      : prisma.deal.findMany({ where: { id: { in: s.dealIds.length ? s.dealIds : none } }, include: { owner: { select: { name: true } } } }),
    crmLinks.length
      ? prisma.activity.findMany({ where: { OR: crmLinks }, take: LIMIT_PER_SOURCE, orderBy: { occurredAt: "desc" }, include: { author: { select: { name: true } } } })
      : [],
    crmLinks.length
      ? prisma.task.findMany({
          where: { OR: crmLinks },
          take: LIMIT_PER_SOURCE,
          orderBy: { createdAt: "desc" },
          include: { assignee: { select: { name: true } } },
        })
      : [],
    prisma.quotation.findMany({
      where: { dealId: { in: s.dealIds.length ? s.dealIds : none } },
      take: LIMIT_PER_SOURCE,
      include: { createdBy: { select: { name: true } } },
    }),
    prisma.ticket.findMany({
      where: { id: { in: s.ticketIds.length ? s.ticketIds : none } },
      include: { createdBy: { select: { name: true } } },
    }),
    prisma.ticketComment.findMany({
      where: { ticketId: { in: s.ticketIds.length ? s.ticketIds : none } },
      take: LIMIT_PER_SOURCE,
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } }, ticket: { select: { number: true } } },
    }),
    prisma.campaignRecipient.findMany({
      where: { contactId: { in: s.contactIds.length ? s.contactIds : none }, status: "SENT" },
      take: LIMIT_PER_SOURCE,
      include: { campaign: { select: { name: true, channel: true } }, contact: { select: { name: true } } },
    }),
    prisma.note.findMany({
      where: { OR: s.noteTargets.length ? s.noteTargets : [{ entityType: type, entityId: id }] },
      take: LIMIT_PER_SOURCE,
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } }, mentions: { include: { user: { select: { name: true } } } } },
    }),
  ]);

  const events: TimelineEvent[] = [];
  const iso = (d: Date) => d.toISOString();

  for (const c of sessions) {
    events.push({
      id: `chat:${c.id}`,
      kind: "chat",
      at: iso(c.createdAt),
      title: `Chat masuk via ${CHANNEL_LABEL[c.channel]} (${c._count.messages} pesan)`,
      detail: c.lead.aiSummary,
      actor: c.assignedAgent ? `Ditangani ${c.assignedAgent.name}` : "AI Agent",
      link: null,
    });
  }
  for (const d of deals) {
    events.push({
      id: `deal:${d.id}`,
      kind: "deal",
      at: iso(d.createdAt),
      title: `Deal dibuat: ${d.title}`,
      detail: `Nilai ${idr(d.amount)}`,
      actor: d.owner.name,
      link: { type: "DEAL", id: d.id },
    });
    if (d.closedAt && (d.stage === "WON" || d.stage === "LOST")) {
      events.push({
        id: `deal-closed:${d.id}`,
        kind: "deal",
        at: iso(d.closedAt),
        title: d.stage === "WON" ? `Deal menang: ${d.title}` : `Deal kalah: ${d.title}`,
        detail: d.stage === "WON" ? idr(d.amount) : (d.lostReason ?? null),
        actor: d.owner.name,
        link: { type: "DEAL", id: d.id },
      });
    }
  }
  for (const a of activities) {
    events.push({
      id: `activity:${a.id}`,
      kind: "activity",
      at: iso(a.occurredAt),
      title: a.subject,
      detail: a.notes,
      actor: a.author.name,
      link: a.dealId ? { type: "DEAL", id: a.dealId } : null,
    });
  }
  for (const t of tasks) {
    events.push({
      id: `task:${t.id}`,
      kind: "task",
      at: iso(t.createdAt),
      title: `Tugas: ${t.title}`,
      detail: `${{ OPEN: "Terbuka", DONE: "Selesai", CANCELLED: "Dibatalkan" }[t.status]}${t.dueAt ? ` · jatuh tempo ${t.dueAt.toLocaleDateString("id-ID")}` : ""}`,
      actor: t.assignee.name,
      link: t.dealId ? { type: "DEAL", id: t.dealId } : null,
    });
  }
  for (const q of quotations) {
    events.push({
      id: `quotation:${q.id}`,
      kind: "quotation",
      at: iso(q.createdAt),
      title: `Quotation ${q.number} (${q.status})`,
      detail: `Total ${idr(q.total)}`,
      actor: q.createdBy.name,
      link: { type: "DEAL", id: q.dealId },
    });
  }
  for (const t of tickets) {
    events.push({
      id: `ticket:${t.id}`,
      kind: "ticket",
      at: iso(t.createdAt),
      title: `Tiket ${t.number}: ${t.subject}`,
      detail: `Status ${t.status} · prioritas ${t.priority}`,
      actor: t.createdBy.name,
      link: { type: "TICKET", id: t.id },
    });
  }
  for (const c of comments) {
    events.push({
      id: `ticket-comment:${c.id}`,
      kind: "ticket_comment",
      at: iso(c.createdAt),
      title: `${c.isInternal ? "Catatan internal" : "Balasan ke customer"} di ${c.ticket.number}`,
      detail: c.body,
      actor: c.author.name,
      link: { type: "TICKET", id: c.ticketId },
    });
  }
  for (const r of campaigns) {
    events.push({
      id: `campaign:${r.id}`,
      kind: "campaign",
      at: iso(r.sentAt ?? r.createdAt),
      title: `Menerima kampanye "${r.campaign.name}" via ${CHANNEL_LABEL[r.campaign.channel]}`,
      detail: type === "ACCOUNT" ? `Penerima: ${r.contact.name}` : null,
      actor: "Marketing",
      link: null,
    });
  }
  for (const n of notes) {
    const mentioned = n.mentions.map((m) => `@${m.user.name}`).join(", ");
    events.push({
      id: `note:${n.id}`,
      kind: "note",
      at: iso(n.createdAt),
      title: "Catatan internal",
      detail: mentioned ? `${n.body}\n— menyebut ${mentioned}` : n.body,
      actor: n.author.name,
      link: n.entityType === type && n.entityId === id ? null : { type: n.entityType, id: n.entityId },
    });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_EVENTS);
}
