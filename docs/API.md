# API contract

All endpoints return JSON. Errors use `{ "error": { "code", "message", "fields?" } }`. State-changing routes validate the browser origin when present and use HTTP-only cookie sessions.

## Auth

| Method | Route | Rule |
|---|---|---|
| POST | `/api/auth/register` | Public; always creates a student |
| POST | `/api/auth/login` | Public; sets revocable cookie session |
| POST | `/api/auth/logout` | Signed-in user; revokes server session |
| GET | `/api/auth/me` | Signed-in user |
| GET | `/api/health` | Database readiness without secret details |

## Student

| Method | Route | Rule |
|---|---|---|
| GET | `/api/services` | Public availability directory |
| GET | `/api/services/:id` | Public service/session detail |
| GET | `/api/services/:id/queue` | Public queue summary (no private student information) |
| POST | `/api/queues/:id/tokens` | Student; server allocates sequence |
| GET | `/api/tokens/me` | Student’s own token list |
| GET | `/api/tokens/:id` | Token owner only |
| POST | `/api/tokens/:id/cancel` | Owner, while waiting/check-in required |
| GET | `/api/tokens/:id/history` | Owner only |
| POST | `/api/check-ins/verify` | Student; `{ proof }`, server verifies signed QR and window |

## Staff and administrator

| Method | Route | Rule |
|---|---|---|
| GET | `/api/staff/services` | Staff assignments or all services for admin |
| GET | `/api/staff/queues/:id` | Assigned staff/admin |
| POST | `/api/staff/queues/:id/next` | Calls first checked-in token |
| POST | `/api/staff/tokens/:id/start` | Called token only |
| POST | `/api/staff/tokens/:id/complete` | Serving token only |
| POST | `/api/staff/tokens/:id/skip` | Called/serving token; optional reason |
| GET | `/api/staff/services/:id/qr` | Assigned staff/admin; fresh signed QR URL/proof |
| GET/POST/PATCH | `/api/admin/locations` | Admin location controls |
| GET/POST/PATCH | `/api/admin/services` | Admin service controls |
| PATCH | `/api/admin/services/:id/policy` | Admin check-in policy |
| GET/POST/DELETE | `/api/admin/staff`, `/api/admin/assignments` | Admin staffing controls |
| POST | `/api/admin/services/:id/queue/open`, `/close` | Admin current operating-day session controls; idempotent and audited |
| POST | `/api/admin/queues/:id/open`, `/close` | Legacy Admin controls; reject a historical session rather than reopening it |
| GET | `/api/admin/analytics`, `/api/admin/history` | Admin reports/audit |
| POST | `/api/admin/demo/open-no-show` | Admin, non-production `DEMO_MODE` only |

## QR verification behavior

The staff QR route stores a rotation row and returns a URL using `PUBLIC_WEB_URL/check-in/confirm?proof=...`. The proof is signed using the independent `QR_SECRET`, rotates every 60 seconds by default and remains valid for 75 seconds, carrying service, queue and a random rotation id. QR expiry is independent of the normal demo token's 15-minute check-in window. The verification endpoint validates signature/expiry, persisted rotation hash, student identity, service binding, current active token and deadline in one transactional flow. The proof is reusable by different eligible students during its short life; an individual token cannot be checked in twice.

## Socket events

`queue:updated` is emitted only to staff/admin queue rooms. `token:updated` is emitted to the token owner’s private room. Clients refetch authoritative REST data after either event and again after reconnect/focus.
