import "dotenv/config";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { AuditActor, QueueStatus, Role, TokenStatus } from "./generated/prisma/client.js";
import { demoNoShowWindowMs, loginSchema, locationSchema, policySchema, registerSchema, serviceSchema } from "@queueless/shared";
import { env, isProduction } from "./env.js";
import { db } from "./db.js";
import { AppError, asyncRoute, errorHandler } from "./http.js";
import { authenticate, clearSessionCookie, createSession, hashPassword, optionalAuthenticate, requireRole, sessionCookie, staffCanOperate, verifyPassword } from "./auth.js";
import { allowedRequestOrigins, isAllowedRequestOrigin } from "./origin.js";
import { createRealtime } from "./realtime.js";
import { closeCurrentQueue, createQrProof, getQueueSnapshot, joinQueue, loadToken, nextEligible, openCurrentQueue, publicToken, runQueueScheduler, sessionKey, tokenPosition, transitionToken, verifyCheckIn } from "./queue.js";
import { startScheduler } from "./scheduler.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-origin" } }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }));
const requestOrigins = allowedRequestOrigins(env.PUBLIC_WEB_URL, env.NODE_ENV, env.ALLOWED_ORIGINS);
app.use((req, _res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !isAllowedRequestOrigin(req.headers.origin, requestOrigins)) return next(new AppError(403, "ORIGIN_REJECTED", "This request origin is not allowed."));
  next();
});
const server = http.createServer(app);
const io = createRealtime(server);

const todayQueue = async (serviceId: string) => db.queue.findUnique({ where: { serviceId_sessionKey: { serviceId, sessionKey: sessionKey() } } });
const userJson = (user: { id: string; name: string; email: string; roleName: Role }) => ({ id: user.id, name: user.name, email: user.email, role: user.roleName });
async function requireTokenOwner(tokenId: string, userId: string) {
  const token = await loadToken(tokenId);
  if (!token) throw new AppError(404, "TOKEN_NOT_FOUND", "Token not found.");
  if (token.userId !== userId) throw new AppError(403, "TOKEN_FORBIDDEN", "You cannot access another student's token.");
  return token;
}
async function requireQueueOperator(queueId: string, user: Express.Request["user"], requireOpen = true) {
  if (!user) throw new AppError(401, "AUTH_REQUIRED", "Please sign in to continue.");
  const queue = await db.queue.findUnique({ where: { id: queueId } });
  if (!queue) throw new AppError(404, "QUEUE_NOT_FOUND", "Queue not found.");
  if (user.role === Role.STAFF && !(await staffCanOperate(user.id, queue.serviceId))) throw new AppError(403, "ASSIGNMENT_REQUIRED", "You are not assigned to this service.");
  if (requireOpen && queue.status !== QueueStatus.OPEN) throw new AppError(409, "QUEUE_CLOSED", "This queue is currently closed.");
  return queue;
}

function routeId(req: express.Request) {
  const value = req.params.id;
  if (typeof value !== "string") throw new AppError(400, "INVALID_ID", "An item id is required.");
  return value;
}

app.get("/api/health", async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: "ready", time: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});
app.get("/api/public/config", (_req, res) => res.json({ demoMode: env.DEMO_MODE, publicWebUrl: env.PUBLIC_WEB_URL, qrRotationSeconds: env.QR_ROTATION_SECONDS, qrTtlSeconds: env.QR_TTL_SECONDS, serverTime: new Date().toISOString() }));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const data = registerSchema.parse(req.body);
  const existing = await db.user.findUnique({ where: { email: data.email } });
  if (existing) throw new AppError(409, "EMAIL_IN_USE", "An account with that email already exists.");
  const user = await db.user.create({ data: { name: data.name, email: data.email, passwordHash: await hashPassword(data.password), roleName: Role.STUDENT } });
  const token = await createSession({ id: user.id, name: user.name, email: user.email, role: user.roleName });
  const cookie = sessionCookie(token); res.cookie(cookie.name, cookie.value, cookie.options).status(201).json({ user: userJson(user) });
}));
app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const data = loginSchema.parse(req.body);
  const user = await db.user.findUnique({ where: { email: data.email } });
  if (!user || !user.active || !(await verifyPassword(user.passwordHash, data.password))) throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  const token = await createSession({ id: user.id, name: user.name, email: user.email, role: user.roleName });
  const cookie = sessionCookie(token); res.cookie(cookie.name, cookie.value, cookie.options).json({ user: userJson(user) });
}));
app.post("/api/auth/logout", optionalAuthenticate, asyncRoute(async (req, res) => { if (req.sessionId) await db.userSession.updateMany({ where: { id: req.sessionId }, data: { revokedAt: new Date() } }); const cookie = clearSessionCookie(); res.clearCookie(cookie.name, cookie.options).status(204).end(); }));
app.get("/api/auth/me", authenticate, (req, res) => res.json({ user: req.user }));

app.get("/api/services", asyncRoute(async (_req, res) => {
  const services = await db.service.findMany({ where: { active: true }, include: { location: true, queues: { where: { sessionKey: sessionKey() }, take: 1, orderBy: { createdAt: "desc" } } }, orderBy: { name: "asc" } });
  res.json({ services: services.map((service) => ({ id: service.id, name: service.name, code: service.code, description: service.description, averageMinutes: service.averageMinutes, location: service.location, queue: service.queues[0] ? { id: service.queues[0].id, status: service.queues[0].status } : null })) });
}));
app.get("/api/services/:id", asyncRoute(async (req, res) => {
  const service = await db.service.findUnique({ where: { id: routeId(req) }, include: { location: true } });
  if (!service || !service.active) throw new AppError(404, "SERVICE_NOT_FOUND", "Service not found.");
  const queue = await todayQueue(service.id); res.json({ service: { ...service, queue } });
}));
app.get("/api/services/:id/queue", asyncRoute(async (req, res) => { const queue = await todayQueue(routeId(req)); if (!queue) throw new AppError(404, "QUEUE_NOT_FOUND", "No queue has been opened for today."); res.json({ queue: await getQueueSnapshot(queue.id) }); }));
app.post("/api/queues/:id/tokens", authenticate, requireRole(Role.STUDENT), asyncRoute(async (req, res) => {
  const created = await joinQueue(routeId(req), req.user!.id, io);
  await runQueueScheduler(io);
  const token = await loadToken(created.id);
  if (!token) throw new AppError(404, "TOKEN_NOT_FOUND", "Token not found.");
  res.status(201).json({ token: publicToken(token, await tokenPosition(token)) });
}));
app.get("/api/tokens/me", authenticate, requireRole(Role.STUDENT), asyncRoute(async (req, res) => {
  const tokens = await db.token.findMany({ where: { userId: req.user!.id }, include: { queue: { include: { service: { include: { location: true } } } } }, orderBy: { joinedAt: "desc" }, take: 30 });
  res.json({ tokens: await Promise.all(tokens.map(async (token) => publicToken(token, await tokenPosition(token)))), serverTime: new Date().toISOString() });
}));
app.get("/api/tokens/:id", authenticate, asyncRoute(async (req, res) => { const token = await requireTokenOwner(routeId(req), req.user!.id); res.json({ token: publicToken(token, await tokenPosition(token)) }); }));
app.post("/api/tokens/:id/cancel", authenticate, requireRole(Role.STUDENT), asyncRoute(async (req, res) => { await requireTokenOwner(routeId(req), req.user!.id); const token = await transitionToken({ tokenId: routeId(req), to: TokenStatus.CANCELLED, actorType: AuditActor.STUDENT, actorId: req.user!.id, allowedFrom: [TokenStatus.WAITING, TokenStatus.CHECKIN_REQUIRED], reason: "Cancelled by student", io }); res.json({ token }); }));
app.get("/api/tokens/:id/history", authenticate, asyncRoute(async (req, res) => { await requireTokenOwner(routeId(req), req.user!.id); const history = await db.queueHistory.findMany({ where: { tokenId: routeId(req) }, orderBy: { createdAt: "asc" } }); res.json({ history }); }));

app.post("/api/check-ins/verify", authenticate, requireRole(Role.STUDENT), asyncRoute(async (req, res) => { const proof = typeof req.body?.proof === "string" ? req.body.proof : ""; if (!proof) throw new AppError(422, "VALIDATION_ERROR", "A QR proof is required."); const token = await verifyCheckIn(proof, req.user!.id, io); res.json({ token, message: "Check-in confirmed. You are eligible to be called." }); }));

app.get("/api/staff/services", authenticate, requireRole(Role.STAFF, Role.ADMIN), asyncRoute(async (req, res) => {
  const services = req.user!.role === Role.ADMIN ? await db.service.findMany({ where: { active: true }, include: { location: true, queues: { where: { sessionKey: sessionKey() }, take: 1 } } }) : await db.service.findMany({ where: { active: true, assignments: { some: { staff: { userId: req.user!.id } } } }, include: { location: true, queues: { where: { sessionKey: sessionKey() }, take: 1 } } });
  res.json({ services: services.map((service) => ({ ...service, queue: service.queues[0] ?? null, queues: undefined })) });
}));
app.get("/api/staff/queues/:id", authenticate, requireRole(Role.STAFF, Role.ADMIN), asyncRoute(async (req, res) => { await requireQueueOperator(routeId(req), req.user, false); res.json({ queue: await getQueueSnapshot(routeId(req), true) }); }));
app.post("/api/staff/queues/:id/next", authenticate, requireRole(Role.STAFF, Role.ADMIN), asyncRoute(async (req, res) => { await requireQueueOperator(routeId(req), req.user); res.json({ token: await nextEligible(routeId(req), req.user!.id, io) }); }));
for (const [path, to, allowed] of [["/api/staff/tokens/:id/start", TokenStatus.SERVING, [TokenStatus.CALLED]], ["/api/staff/tokens/:id/complete", TokenStatus.COMPLETED, [TokenStatus.SERVING]], ["/api/staff/tokens/:id/skip", TokenStatus.SKIPPED, [TokenStatus.CALLED, TokenStatus.SERVING]]] as const) {
  app.post(path, authenticate, requireRole(Role.STAFF, Role.ADMIN), asyncRoute(async (req, res) => { const existing = await loadToken(routeId(req)); if (!existing) throw new AppError(404, "TOKEN_NOT_FOUND", "Token not found."); await requireQueueOperator(existing.queueId, req.user); const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : undefined; res.json({ token: await transitionToken({ tokenId: existing.id, to, actorType: AuditActor.STAFF, actorId: req.user!.id, allowedFrom: [...allowed], reason, io }) }); }));
}
app.get("/api/staff/services/:id/qr", authenticate, requireRole(Role.STAFF, Role.ADMIN), asyncRoute(async (req, res) => { if (req.user!.role === Role.STAFF && !(await staffCanOperate(req.user!.id, routeId(req)))) throw new AppError(403, "ASSIGNMENT_REQUIRED", "You are not assigned to this service."); const queue = await todayQueue(routeId(req)); if (!queue || queue.status !== QueueStatus.OPEN) throw new AppError(409, "QUEUE_CLOSED", "Open the queue before showing its QR code."); res.json(await createQrProof(routeId(req), queue.id)); }));

app.get("/api/admin/locations", authenticate, requireRole(Role.ADMIN), asyncRoute(async (_req, res) => res.json({ locations: await db.location.findMany({ orderBy: { name: "asc" } }) })));
app.post("/api/admin/locations", authenticate, requireRole(Role.ADMIN), asyncRoute(async (req, res) => res.status(201).json({ location: await db.location.create({ data: locationSchema.parse(req.body) }) })));
app.patch("/api/admin/locations/:id", authenticate, requireRole(Role.ADMIN), asyncRoute(async (req, res) => res.json({ location: await db.location.update({ where: { id: routeId(req) }, data: locationSchema.partial().parse(req.body) }) })));
app.get("/api/admin/services", authenticate, requireRole(Role.ADMIN), asyncRoute(async (_req, res) => res.json({ services: await db.service.findMany({ include: { location: true, assignments: { include: { staff: { include: { user: true } } } }, queues: { where: { sessionKey: sessionKey() }, take: 1 } }, orderBy: { name: "asc" } }) })));
app.post("/api/admin/services", authenticate, requireRole(Role.ADMIN), asyncRoute(async (req, res) => { const data = serviceSchema.parse(req.body); const service = await db.service.create({ data }); const opened = await openCurrentQueue(service.id, req.user!.id, io); res.status(201).json({ service, queue: opened.queue, message: `${service.name} created and its queue opened successfully.` }); }));
app.patch("/api/admin/services/:id", authenticate, requireRole(Role.ADMIN), asyncRoute(async (req, res) => res.json({ service: await db.service.update({ where: { id: routeId(req) }, data: serviceSchema.partial().parse(req.body) }) })));
app.patch("/api/admin/services/:id/policy", authenticate, requireRole(Role.ADMIN), asyncRoute(async (req, res) => res.json({ service: await db.service.update({ where: { id: routeId(req) }, data: policySchema.parse(req.body) }) })));
app.get("/api/admin/staff", authenticate, requireRole(Role.ADMIN), asyncRoute(async (_req, res) => res.json({ staff: await db.staff.findMany({ include: { user: { select: { id: true, name: true, email: true } }, assignments: { include: { service: true } } } }) })));
app.post("/api/admin/assignments", authenticate, requireRole(Role.ADMIN), asyncRoute(async (req, res) => { const staffId = String(req.body?.staffId || ""); const serviceId = String(req.body?.serviceId || ""); if (!staffId || !serviceId) throw new AppError(422, "VALIDATION_ERROR", "Staff and service are required."); res.status(201).json({ assignment: await db.staffService.create({ data: { staffId, serviceId } }) }); }));
app.delete("/api/admin/assignments/:id", authenticate, requireRole(Role.ADMIN), asyncRoute(async (req, res) => { await db.staffService.delete({ where: { id: routeId(req) } }); res.status(204).end(); }));
app.post("/api/admin/services/:id/queue/open", authenticate, requireRole(Role.ADMIN), asyncRoute(async (req, res) => res.json(await openCurrentQueue(routeId(req), req.user!.id, io))));
app.post("/api/admin/services/:id/queue/close", authenticate, requireRole(Role.ADMIN), asyncRoute(async (req, res) => res.json(await closeCurrentQueue(routeId(req), req.user!.id, io))));
for (const [path, action] of [["/api/admin/queues/:id/open", "open"], ["/api/admin/queues/:id/close", "close"]] as const) app.post(path, authenticate, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
  const queue = await db.queue.findUnique({ where: { id: routeId(req) } });
  if (!queue) throw new AppError(404, "QUEUE_NOT_FOUND", "Queue not found.");
  if (queue.sessionKey !== sessionKey()) throw new AppError(409, "STALE_QUEUE_SESSION", "Historical sessions cannot be reopened. Open the current operating-day queue from the service controls.");
  res.json(action === "open" ? await openCurrentQueue(queue.serviceId, req.user!.id, io) : await closeCurrentQueue(queue.serviceId, req.user!.id, io));
}));
app.get("/api/admin/analytics", authenticate, requireRole(Role.ADMIN), asyncRoute(async (_req, res) => {
  const operatingDate = sessionKey();
  const currentTokenWhere = { queue: { sessionKey: operatingDate } };
  const [byStatus, services, completed, activeQueues] = await Promise.all([
    db.token.groupBy({ by: ["status"], where: currentTokenWhere, _count: { _all: true } }),
    db.service.findMany({ include: { queues: { where: { sessionKey: operatingDate }, include: { tokens: true }, take: 1 } }, orderBy: { name: "asc" } }),
    db.token.findMany({ where: { status: TokenStatus.COMPLETED, startedAt: { not: null }, completedAt: { not: null }, ...currentTokenWhere } }),
    db.queue.count({ where: { status: QueueStatus.OPEN, sessionKey: operatingDate } })
  ]);
  const count = (status: TokenStatus) => byStatus.find((item) => item.status === status)?._count._all ?? 0;
  const sampled = completed.map((t) => (t.completedAt!.getTime() - t.startedAt!.getTime()) / 60_000);
  res.json({ operatingDate, timeZone: env.CAMPUS_TIME_ZONE, summary: { activeQueues, waiting: count(TokenStatus.WAITING) + count(TokenStatus.CHECKIN_REQUIRED), checkedIn: count(TokenStatus.CHECKED_IN), completed: count(TokenStatus.COMPLETED), noShow: count(TokenStatus.NO_SHOW), cancelled: count(TokenStatus.CANCELLED), averageServiceMinutes: sampled.length ? Math.round(sampled.reduce((a, b) => a + b, 0) / sampled.length) : null }, services: services.map((service) => ({ id: service.id, name: service.name, code: service.code, joined: service.queues.flatMap((q) => q.tokens).length, completed: service.queues.flatMap((q) => q.tokens).filter((t) => t.status === TokenStatus.COMPLETED).length, noShow: service.queues.flatMap((q) => q.tokens).filter((t) => t.status === TokenStatus.NO_SHOW).length })) });
}));
app.get("/api/admin/history", authenticate, requireRole(Role.ADMIN), asyncRoute(async (_req, res) => {
  const [tokenHistory, sessionHistory] = await Promise.all([
    db.queueHistory.findMany({ include: { token: { include: { user: { select: { name: true } }, queue: { include: { service: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.queueSessionHistory.findMany({ include: { queue: { include: { service: true } } }, orderBy: { createdAt: "desc" }, take: 100 })
  ]);
  const history = [...tokenHistory, ...sessionHistory.map((entry) => ({ ...entry, token: null, service: entry.queue.service }))].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 100);
  res.json({ history });
}));
app.post("/api/admin/demo/open-no-show", authenticate, requireRole(Role.ADMIN), asyncRoute(async (req, res) => {
  if (isProduction || !env.DEMO_MODE) throw new AppError(404, "NOT_FOUND", "Not found.");
  const token = await db.token.findFirst({ where: { status: TokenStatus.WAITING }, orderBy: { joinedAt: "asc" } });
  if (!token) throw new AppError(409, "NO_DEMO_TOKEN", "No waiting demo token is available.");
  const openedAt = new Date();
  await db.token.update({ where: { id: token.id }, data: { status: TokenStatus.CHECKIN_REQUIRED, checkinOpenedAt: openedAt, checkinDeadlineAt: new Date(openedAt.getTime() + demoNoShowWindowMs(env.DEMO_NO_SHOW_GRACE_SECONDS)) } });
  await db.queueHistory.create({ data: { tokenId: token.id, actorType: AuditActor.ADMIN, actorId: req.user!.id, fromStatus: TokenStatus.WAITING, toStatus: TokenStatus.CHECKIN_REQUIRED, action: "demo_no_show_window" } });
  io.to(`user:${token.userId}`).emit("token:updated", { queueId: token.queueId }); io.to(`queue:${token.queueId}`).emit("queue:updated", { queueId: token.queueId });
  res.json({ message: `Demo no-show window opened for ${env.DEMO_NO_SHOW_GRACE_SECONDS} seconds.`, tokenId: token.id });
}));

app.use(errorHandler);
const stopScheduler = startScheduler(io);
server.listen(env.PORT, () => console.log(`QueueLess API listening at http://localhost:${env.PORT}`));
function shutdown() { stopScheduler(); io.close(); server.close(() => void db.$disconnect().finally(() => process.exit(0))); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
