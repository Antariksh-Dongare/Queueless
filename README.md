# QueueLess

QueueLess is a local-first digital queue and token management system for campus service counters. Students join an open queue remotely; near their turn they must scan the counter’s rotating signed QR code to remain eligible. Staff then call verified students in token order. The stack is React/Vite, Express/Socket.IO, PostgreSQL and Prisma 7.1.

## Requirements

- macOS/Linux with Node **24+** (verified with Node 24.21.0)
- Docker Desktop running (PostgreSQL is deliberately the only container)
- npm 11+

## First local setup

From the repository root:

```bash
npm install
npm run setup:local
npm run dev
```

Open <http://localhost:5173>. The Vite proxy keeps browser cookies, REST calls, and Socket.IO same-origin. The API is at <http://localhost:4000> and its database-aware health check is <http://localhost:4000/api/health>.

`setup:local` copies `.env.example` to `.env` when needed, starts PostgreSQL, deploys Prisma migrations, and seeds the demo. The checked-in `.env.example` contains safe local-only defaults; replace both secrets before any non-demo use.

## Commands

```bash
npm run db:up          # start PostgreSQL volume
npm run db:down        # stop PostgreSQL (preserves data)
npm run db:migrate     # deploy checked-in migrations
npm run db:seed        # idempotently seed demo accounts/services
npm run demo:reset     # destructive local demo reset; blocked unless DEMO_MODE=true and not production
npm run dev            # API :4000 + web :5173
npm run dev:lan        # detects the Mac LAN IP, then starts API :4000 + web :5173
npm run lint
npm run typecheck
npm run test
npm run test:e2e       # requires E2E_DATABASE_URL pointing to a separate test database
npm run build
```

## Local demo accounts

All local-only accounts use `Demo@12345`:

| Role | Email |
|---|---|
| Administrator | `admin@queueless.local` |
| Staff counter operator | `staff@queueless.local` |
| Student A | `anaya@queueless.local` |
| Student B | `rahul@queueless.local` |
| Student C | `priya@queueless.local` |

The demo account shortcuts are served only while server-side `DEMO_MODE=true`.

## Daily queue sessions

Queue sessions are manual and use `CAMPUS_TIME_ZONE=Asia/Kolkata` by default. Seeding creates historical sample data but does not force a current-day queue open. At the beginning of a demonstration, sign in as `admin@queueless.local`, open **Administration**, and choose **Open Queue** beside the required service (for example, Bonafide Certificate). The same button is idempotent; it never creates a duplicate current-day session. **Close Queue** preserves history, cancels pending unserved tokens with an audit reason, and refuses to interrupt a called or serving student. A future operating day starts closed until an administrator explicitly opens its new session.

## Design and safety notes

- The server, not the browser, owns token sequence, positions, status, deadline, roles, and timestamps.
- Each token transition is constrained and produces a `queue_history` audit row; each queue-session open/close decision has a separate `queue_session_history` audit row.
- Token allocation holds a PostgreSQL advisory lock in a serializable transaction and uses unique constraints.
- Sessions are signed HTTP-only cookies backed by revocable `user_sessions` rows. Public registration creates students only.
- Counter QR codes are JWT-signed, have a short expiry, are persisted by hashed rotation id, and may be used by multiple eligible students once each. A screen snapshot is not claimed to prove physical presence.
- Scheduler ticks independently of browsers and only expires persisted, overdue `CHECKIN_REQUIRED` tokens. A check-in deadline is never reset when position changes.

Read [the classroom demo guide](docs/DEMO_GUIDE.md) before presenting. The implementation details and acceptance boundaries are in [architecture](docs/ARCHITECTURE.md), [database design](docs/DATABASE.md), [API contract](docs/API.md), and [testing guide](docs/TESTING.md).

## Phone / Android-hotspot QR demo

QueueLess is LAN-ready without exposing the API directly: Vite listens on all interfaces and proxies `/api` and `/socket.io` on the same browser origin. That keeps the signed HTTP-only session cookie, origin validation, RBAC, and WebSocket upgrade path intact.

For the current hotspot address, run:

```bash
npm run dev:lan
```

`dev:lan` prints the selected address (for example `http://10.252.0.27:5173`). Open that printed address on both the Mac and the Android phone while they are connected to the same personal hotspot. The API accepts only the exact configured LAN origin plus `localhost:5173`/`127.0.0.1:5173` in development; it does not use a wildcard CORS rule. This command makes QR links use that address and never puts `localhost` or the API port in browser-side requests. To choose an interface explicitly after a hotspot change:

```bash
QUEUELESS_LAN_IP=NEW_MAC_IP npm run dev:lan
```

Allow the macOS firewall prompt for Node if shown. After `npm install` and local database setup have completed, the demo needs no internet connection: it uses the local Vite server, local API, Socket.IO and PostgreSQL only. A phone camera can open an HTTP QR URL; browser Camera APIs are not promised on non-HTTPS LAN addresses.

## Troubleshooting

- `docker: command not found`: install/start Docker Desktop, then rerun `npm run setup:local`.
- `EADDRINUSE`: stop the existing QueueLess terminal with `Ctrl+C`. If a previous terminal was abandoned, inspect only the two listeners with `lsof -nP -iTCP:4000 -sTCP:LISTEN` and `lsof -nP -iTCP:5173 -sTCP:LISTEN`, stop those specific PIDs, then run `npm run dev:lan` once.
- `/api/health` reports a generic error: check `docker compose ps`, then rerun `npm run db:migrate` and `npm run db:seed`.
- Resetting only the demo: use `npm run demo:reset`; it refuses production and non-demo settings.
- All services show **Closed** after midnight: this is expected until an administrator opens that operating day’s queue. Sign in as administrator and choose **Open Queue** for the service. Previous-day sessions and token history remain unchanged.
- “This request origin is not allowed”: use the exact URL printed by `npm run dev:lan`, or use `http://localhost:5173`. Do not mix a stale hotspot IP with the current LAN URL.
