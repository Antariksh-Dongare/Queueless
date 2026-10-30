-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('OPEN', 'CLOSED', 'PAUSED');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('WAITING', 'CHECKIN_REQUIRED', 'CHECKED_IN', 'CALLED', 'SERVING', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AuditActor" AS ENUM ('STUDENT', 'STAFF', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CheckInResult" AS ENUM ('SUCCESS', 'EXPIRED', 'INVALID_SIGNATURE', 'WRONG_SERVICE', 'OUT_OF_WINDOW', 'DUPLICATE', 'NOT_ELIGIBLE');

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" "Role" NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role_name" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "designation" TEXT,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "building" TEXT NOT NULL,
    "floor" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "average_minutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "checkin_lead_minutes" INTEGER NOT NULL DEFAULT 10,
    "checkin_lead_tokens" INTEGER NOT NULL DEFAULT 3,
    "checkin_grace_minutes" INTEGER NOT NULL DEFAULT 5,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_services" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,

    CONSTRAINT "staff_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queues" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "session_key" TEXT NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'OPEN',
    "next_sequence" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "display_token" TEXT NOT NULL,
    "status" "TokenStatus" NOT NULL DEFAULT 'WAITING',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkin_opened_at" TIMESTAMP(3),
    "checkin_deadline_at" TIMESTAMP(3),
    "checked_in_at" TIMESTAMP(3),
    "called_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "jti_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_ins" (
    "id" TEXT NOT NULL,
    "token_id" TEXT,
    "user_id" TEXT NOT NULL,
    "qr_code_id" TEXT,
    "result" "CheckInResult" NOT NULL,
    "reason" TEXT,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_history" (
    "id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_type" "AuditActor" NOT NULL,
    "from_status" "TokenStatus",
    "to_status" "TokenStatus",
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_expires_at_idx" ON "user_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_user_id_key" ON "staff"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_code_key" ON "services"("code");

-- CreateIndex
CREATE INDEX "services_location_id_active_idx" ON "services"("location_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "staff_services_staff_id_service_id_key" ON "staff_services"("staff_id", "service_id");

-- CreateIndex
CREATE INDEX "queues_service_id_status_idx" ON "queues"("service_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "queues_service_id_session_key_key" ON "queues"("service_id", "session_key");

-- CreateIndex
CREATE INDEX "tokens_queue_id_status_sequence_idx" ON "tokens"("queue_id", "status", "sequence");

-- CreateIndex
CREATE INDEX "tokens_user_id_status_idx" ON "tokens"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_queue_id_sequence_key" ON "tokens"("queue_id", "sequence");

-- A student can hold only one active token within a service-day queue.
CREATE UNIQUE INDEX "tokens_one_active_per_user_queue"
ON "tokens" ("queue_id", "user_id")
WHERE "status" IN ('WAITING','CHECKIN_REQUIRED','CHECKED_IN','CALLED','SERVING');

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_jti_hash_key" ON "qr_codes"("jti_hash");

-- CreateIndex
CREATE INDEX "qr_codes_service_id_expires_at_idx" ON "qr_codes"("service_id", "expires_at");

-- CreateIndex
CREATE INDEX "check_ins_user_id_attempted_at_idx" ON "check_ins"("user_id", "attempted_at");

-- CreateIndex
CREATE INDEX "check_ins_token_id_result_idx" ON "check_ins"("token_id", "result");

-- CreateIndex
CREATE INDEX "queue_history_token_id_created_at_idx" ON "queue_history"("token_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_name_fkey" FOREIGN KEY ("role_name") REFERENCES "roles"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queues" ADD CONSTRAINT "queues_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_qr_code_id_fkey" FOREIGN KEY ("qr_code_id") REFERENCES "qr_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_history" ADD CONSTRAINT "queue_history_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

