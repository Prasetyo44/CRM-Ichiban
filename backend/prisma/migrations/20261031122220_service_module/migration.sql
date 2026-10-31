-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('PRODUCT_QUALITY', 'DELIVERY', 'TECHNICAL_SUPPORT', 'WARRANTY_CLAIM', 'BILLING', 'OTHER');

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL DEFAULT 'OTHER',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "customerType" "CustomerType",
    "productLineId" TEXT,
    "batchNumber" TEXT,
    "accountId" TEXT,
    "contactId" TEXT,
    "dealId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "firstResponseDueAt" TIMESTAMP(3) NOT NULL,
    "resolutionDueAt" TIMESTAMP(3) NOT NULL,
    "firstRespondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "tickets_assigneeId_status_idx" ON "tickets"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "tickets_status_resolutionDueAt_idx" ON "tickets"("status", "resolutionDueAt");

-- CreateIndex
CREATE INDEX "tickets_accountId_idx" ON "tickets"("accountId");

-- CreateIndex
CREATE INDEX "tickets_contactId_idx" ON "tickets"("contactId");

-- CreateIndex
CREATE INDEX "ticket_comments_ticketId_createdAt_idx" ON "ticket_comments"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES "product_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
