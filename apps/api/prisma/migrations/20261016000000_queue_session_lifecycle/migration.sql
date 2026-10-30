-- Queue-session lifecycle records are separate from token transitions, so an
-- administrator can audit an open/close decision even when no token exists.
CREATE TABLE "queue_session_history" (
    "id" TEXT NOT NULL,
    "queue_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_type" "AuditActor" NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_session_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "queue_session_history_queue_id_created_at_idx"
ON "queue_session_history"("queue_id", "created_at");

ALTER TABLE "queue_session_history"
ADD CONSTRAINT "queue_session_history_queue_id_fkey"
FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
