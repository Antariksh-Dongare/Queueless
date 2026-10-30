# Testing and verification

## Fast quality gate

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

The unit suites cover:

- state-machine validity and terminal-state rejection;
- non-negative ETA calculation;
- queue selection that bypasses unverified earlier tokens but chooses the first checked-in token;
- check-in opening by either lead-token or ETA threshold and stable deadline calculation;
- QR JWT signature/tampering and expiry validation.
- Asia/Kolkata operating-day rollover, exact LAN/localhost origin allow-listing, and the independent normal/demo timing rules.

## Integration and browser isolation

Database and browser tests must never touch the normal `queueless` demo database. Create a separate PostgreSQL database, then provide it as `E2E_DATABASE_URL`:

```bash
createdb queueless_e2e
E2E_DATABASE_URL='postgresql://queueless:queueless_local_only@localhost:5432/queueless_e2e?schema=public' npm run test:e2e
```

Playwright’s web server then migrates/seeds that separate database, starts the API and Vite, and tests admin close/reopen idempotency, staff QR availability, student check-in, independent cookie contexts, logout invalidation, and mobile layout. It never targets the normal `queueless` demo database.

## Manual acceptance test

Use [DEMO_GUIDE.md](DEMO_GUIDE.md). It validates two independent cookie sessions, Socket.IO updates, the signed QR flow, complete service lifecycle, automatic no-show and analytics. The health route is database-aware; a 200 response means Prisma can query PostgreSQL.

## Current environment boundary

The repository is designed to test against Docker PostgreSQL. If Docker Desktop is absent, lint/typecheck/unit/build can run but migrations, seeded API integration, local E2E and the live two-window proof cannot be claimed as verified. Run `npm run setup:local` once Docker is installed, then execute this whole guide.
