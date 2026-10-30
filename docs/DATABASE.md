# Database design

The Prisma schema is the source of truth: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma). Its initial PostgreSQL migration is checked in under `apps/api/prisma/migrations`.

```mermaid
erDiagram
  ROLES ||--o{ USERS : grants
  USERS ||--o| STAFF : may_have
  USERS ||--o{ USER_SESSIONS : owns
  STAFF ||--o{ STAFF_SERVICES : assigned
  SERVICES ||--o{ STAFF_SERVICES : staffed_by
  LOCATIONS ||--o{ SERVICES : houses
  SERVICES ||--o{ QUEUES : opens
  QUEUES ||--o{ QUEUE_SESSION_HISTORY : lifecycle_audited_by
  QUEUES ||--o{ TOKENS : allocates
  USERS ||--o{ TOKENS : receives
  SERVICES ||--o{ QR_CODES : rotates
  QUEUES ||--o{ QR_CODES : for_session
  TOKENS ||--o{ CHECK_INS : attempts
  USERS ||--o{ CHECK_INS : makes
  QR_CODES ||--o{ CHECK_INS : verifies
  TOKENS ||--o{ QUEUE_HISTORY : audited_by
```

Important constraints include unique role names, normalized unique emails, unique service short codes, one queue per service/session key, unique queue sequence, unique QR rotation hash, and a PostgreSQL partial index preventing more than one active token for a student in a queue. Foreign keys preserve history; disabling a service does not delete tokens.

`queues.session_key` is the `CAMPUS_TIME_ZONE` operating date, not a timestamp; timestamps remain UTC. The unique `(service_id, session_key)` constraint permits exactly one session per service/day. `tokens` stores the stable `checkin_opened_at` and `checkin_deadline_at`. `qr_codes` stores a SHA-256 hash of the rotation id, never the reusable signed payload. `check_ins` records successful and rejected attempts without exposing raw QR proofs. `queue_history` records token transitions, while `queue_session_history` records authorized session open/reopen/close decisions.

## Token state transitions

```mermaid
stateDiagram-v2
  [*] --> WAITING
  WAITING --> CHECKIN_REQUIRED: scheduler
  WAITING --> CANCELLED: student
  CHECKIN_REQUIRED --> CHECKED_IN: signed counter QR
  CHECKIN_REQUIRED --> NO_SHOW: deadline expired
  CHECKIN_REQUIRED --> CANCELLED: student
  CHECKED_IN --> CALLED: staff selection
  CHECKED_IN --> CANCELLED: student
  CALLED --> SERVING: staff
  CALLED --> SKIPPED: staff
  SERVING --> COMPLETED: staff
  SERVING --> SKIPPED: staff
```
