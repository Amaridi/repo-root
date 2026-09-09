-- CreateEnum
CREATE TYPE "public"."DepositRequestStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUBMITTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."DocumentStatus" AS ENUM ('PENDING', 'AVAILABLE');

-- CreateTable
CREATE TABLE "public"."lawyer" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lawyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deposit_request" (
    "id" UUID NOT NULL,
    "lawyerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "clientName" TEXT NOT NULL,
    "clientEmail" TEXT,
    "status" "public"."DepositRequestStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposit_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lawyer_email_key" ON "public"."lawyer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_request_tokenHash_key" ON "public"."deposit_request"("tokenHash");

-- CreateIndex
CREATE INDEX "deposit_request_lawyerId_idx" ON "public"."deposit_request"("lawyerId");

-- CreateIndex
CREATE INDEX "deposit_request_expiresAt_idx" ON "public"."deposit_request"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "document_storageKey_key" ON "public"."document"("storageKey");

-- CreateIndex
CREATE INDEX "document_requestId_idx" ON "public"."document"("requestId");

-- AddForeignKey
ALTER TABLE "public"."deposit_request" ADD CONSTRAINT "deposit_request_lawyerId_fkey" FOREIGN KEY ("lawyerId") REFERENCES "public"."lawyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document" ADD CONSTRAINT "document_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."deposit_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
