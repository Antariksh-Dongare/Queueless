import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { CheckInResult, QueueStatus, TokenStatus, AuditActor } from "./generated/prisma/client.js";
import { assertTransition, buildCheckInUrl, checkinWindowMs, estimateWaitMinutes, operatingDayKey, qrPayloadSchema, shouldOpenCheckinWindow } from "@queueless/shared";
import { db } from "./db.js";
import { env } from "./env.js";
import { AppError } from "./http.js";
import type { Realtime } from "./realtime.js";
import { notifyQueue, notifySessions } from "./realtime.js";

const activeStatuses: TokenStatus[] = [TokenStatus.WAITING, TokenStatus.CHECKIN_REQUIRED, TokenStatus.CHECKED_IN, TokenStatus.CALLED, TokenStatus.SERVING];
const isActive = (status: TokenStatus) => activeStatuses.includes(status);
const tokenInclude = { queue: { include: { service: { include: { location: true } } } }, user: { select: { id: true, name: true, email: true } } } as const;
export type TokenView = Awaited<ReturnType<typeof db.token.findUnique>>;

/** Session keys follow the configured campus operating day, never the server's UTC date. */
export function sessionKey(now = new Date()) { return operatingDayKey(now, env.CAMPUS_TIME_ZONE); }
export function publicToken(token: any, position?: number) {
  const service = token.queue?.service;
  return {
    id: token.id, displayToken: token.displayToken, sequence: token.sequence, status: token.status, joinedAt: token.joinedAt,
    checkinOpenedAt: token.checkinOpenedAt, checkinDeadlineAt: token.checkinDeadlineAt, checkedInAt: token.checkedInAt,
    calledAt: token.calledAt, startedAt: token.startedAt, completedAt: token.completedAt, reason: token.reason,
    position: position ?? null, estimatedWaitMinutes: service && position !== undefined ? estimateWaitMinutes(position, service.averageMinutes) : null,
    service: service ? { id: service.id, name: service.name, code: service.code, averageMinutes: service.averageMinutes, location: service.location } : undefined,
    queueId: token.queueId, user: token.user ? { id: token.user.id, name: token.user.name } : undefined
  };
}
export async function tokenPosition(token: { id: string; queueId: string; sequence: number; status: TokenStatus }) {
  if (!isActive(token.status)) return 0;
  return db.token.count({ where: { queueId: token.queueId, sequence: { lt: token.sequence }, status: { in: activeStatuses } } });
}
export async function loadToken(id: string) {
  return db.token.findUnique({ where: { id }, include: tokenInclude });
}

async function writeHistory(tx: typeof db, tokenId: string, actorType: AuditActor, fromStatus: TokenStatus | null, toStatus: TokenStatus | null, action: string, actorId?: string, reason?: string) {
  await tx.queueHistory.create({ data: { tokenId, actorType, fromStatus, toStatus, action, actorId, reason } });
}

function retryableSessionError(error: unknown) {
  const code = (error as { code?: string } | undefined)?.code;
  return code === "P2034" || code === "P2002";
}

/**
 * Opens only the current operating-day session. A closed historical session is
 * never selected because its key cannot equal today's timezone-aware key.
 */
export async function openCurrentQueue(serviceId: string, actorId: string, io?: Realtime) {
  const key = sessionKey();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const changed = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`queue-session:${serviceId}:${key}`}))`;
        const service = await tx.service.findUnique({ where: { id: serviceId }, select: { id: true, name: true, active: true } });
        if (!service) throw new AppError(404, "SERVICE_NOT_FOUND", "Service not found.");
        if (!service.active) throw new AppError(409, "SERVICE_DISABLED", "Enable this service before opening its queue.");
        const current = await tx.queue.findUnique({ where: { serviceId_sessionKey: { serviceId, sessionKey: key } } });
        const now = new Date();
        if (current?.status === QueueStatus.OPEN) return { queue: current, serviceName: service.name, action: "already_open" as const, cancelled: 0 };
        const queue = current
          ? await tx.queue.update({ where: { id: current.id }, data: { status: QueueStatus.OPEN, openedAt: now, closedAt: null } })
          : await tx.queue.create({ data: { serviceId, sessionKey: key, status: QueueStatus.OPEN, openedAt: now } });
        const action = current ? "reopened" as const : "opened" as const;
        await tx.queueSessionHistory.create({ data: { queueId: queue.id, actorId, actorType: AuditActor.ADMIN, action } });
        return { queue, serviceName: service.name, action, cancelled: 0 };
      }, { isolationLevel: "Serializable" });
      if (io) notifySessions(io, changed.queue.id);
      return { ...changed, message: changed.action === "already_open" ? `${changed.serviceName} queue is already open.` : `${changed.serviceName} queue opened successfully.` };
    } catch (error) {
      if (retryableSessionError(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new AppError(409, "QUEUE_BUSY", "The queue changed just now. Please try again.");
}

/**
 * Closing never removes history. It cancels tokens that have not reached the
 * counter and refuses to interrupt a called/in-service student.
 */
export async function closeCurrentQueue(serviceId: string, actorId: string, io?: Realtime) {
  const key = sessionKey();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const changed = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`queue-session:${serviceId}:${key}`}))`;
        const service = await tx.service.findUnique({ where: { id: serviceId }, select: { id: true, name: true } });
        if (!service) throw new AppError(404, "SERVICE_NOT_FOUND", "Service not found.");
        const current = await tx.queue.findUnique({ where: { serviceId_sessionKey: { serviceId, sessionKey: key } } });
        if (!current || current.status !== QueueStatus.OPEN) {
          return { queue: current ?? { id: "", status: QueueStatus.CLOSED, sessionKey: key, openedAt: null, closedAt: null }, serviceName: service.name, action: "already_closed" as const, cancelled: 0 };
        }
        const busy = await tx.token.findFirst({ where: { queueId: current.id, status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] } }, select: { displayToken: true } });
        if (busy) throw new AppError(409, "COUNTER_BUSY", `Finish or skip ${busy.displayToken} before closing this queue.`);
        const pending = await tx.token.findMany({ where: { queueId: current.id, status: { in: [TokenStatus.WAITING, TokenStatus.CHECKIN_REQUIRED, TokenStatus.CHECKED_IN] } }, select: { id: true, status: true } });
        const reason = "Queue closed by administrator";
        if (pending.length) {
          await tx.token.updateMany({ where: { id: { in: pending.map((token) => token.id) } }, data: { status: TokenStatus.CANCELLED, reason } });
          await tx.queueHistory.createMany({ data: pending.map((token) => ({ tokenId: token.id, actorId, actorType: AuditActor.ADMIN, fromStatus: token.status, toStatus: TokenStatus.CANCELLED, action: "queue_closed", reason })) });
        }
        const queue = await tx.queue.update({ where: { id: current.id }, data: { status: QueueStatus.CLOSED, closedAt: new Date() } });
        await tx.queueSessionHistory.create({ data: { queueId: queue.id, actorId, actorType: AuditActor.ADMIN, action: "closed", reason: pending.length ? `${pending.length} pending token(s) cancelled.` : undefined } });
        return { queue, serviceName: service.name, action: "closed" as const, cancelled: pending.length };
      }, { isolationLevel: "Serializable" });
      if (io && changed.queue.id) {
        notifyQueue(io, changed.queue.id);
        notifySessions(io, changed.queue.id);
      }
      return { ...changed, message: changed.action === "already_closed" ? `${changed.serviceName} queue is already closed.` : `${changed.serviceName} queue closed.${changed.cancelled ? ` ${changed.cancelled} pending token${changed.cancelled === 1 ? " was" : "s were"} cancelled.` : ""}` };
    } catch (error) {
      if (retryableSessionError(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new AppError(409, "QUEUE_BUSY", "The queue changed just now. Please try again.");
}

export async function transitionToken(input: { tokenId: string; to: TokenStatus; actorType: AuditActor; actorId?: string; reason?: string; allowedFrom?: TokenStatus[]; io?: Realtime }) {
  const changed = await db.$transaction(async (tx) => {
    const token = await tx.token.findUnique({ where: { id: input.tokenId }, include: tokenInclude });
    if (!token) throw new AppError(404, "TOKEN_NOT_FOUND", "Token not found.");
    if (input.allowedFrom && !input.allowedFrom.includes(token.status)) throw new AppError(409, "INVALID_TOKEN_STATE", `This action is not available while the token is ${token.status.replaceAll("_", " ")}.`);
    try { assertTransition(token.status, input.to); } catch (error) { throw new AppError(409, "INVALID_TRANSITION", error instanceof Error ? error.message : "Invalid transition."); }
    const now = new Date();
    const dates: Record<string, Date> = {};
    if (input.to === TokenStatus.CHECKED_IN) dates.checkedInAt = now;
    if (input.to === TokenStatus.CALLED) dates.calledAt = now;
    if (input.to === TokenStatus.SERVING) dates.startedAt = now;
    if (input.to === TokenStatus.COMPLETED) dates.completedAt = now;
    const updated = await tx.token.update({ where: { id: token.id }, data: { status: input.to, reason: input.reason, ...dates }, include: tokenInclude });
    await writeHistory(tx as typeof db, token.id, input.actorType, token.status, input.to, input.to.toLowerCase(), input.actorId, input.reason);
    return updated;
  });
  const position = await tokenPosition(changed);
  if (input.io) notifyQueue(input.io, changed.queueId, [changed.userId]);
  return publicToken(changed, position);
}

/** Uses a DB advisory lock plus serializable transaction, so parallel joins cannot reuse a sequence. */
export async function joinQueue(queueId: string, userId: string, io?: Realtime) {
  let attempts = 0;
  while (attempts++ < 3) {
    try {
      const token = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${queueId}:${userId}`}))`;
        const queue = await tx.queue.findUnique({ where: { id: queueId }, include: { service: true } });
        if (!queue || !queue.service.active) throw new AppError(404, "QUEUE_NOT_FOUND", "This service is no longer available.");
        if (queue.status !== QueueStatus.OPEN) throw new AppError(409, "QUEUE_CLOSED", "This queue is currently closed.");
        const duplicate = await tx.token.findFirst({ where: { queueId, userId, status: { in: activeStatuses } } });
        if (duplicate) throw new AppError(409, "ACTIVE_TOKEN_EXISTS", "You already have an active token for this service.");
        const sequence = queue.nextSequence;
        await tx.queue.update({ where: { id: queueId }, data: { nextSequence: { increment: 1 } } });
        const created = await tx.token.create({ data: { queueId, userId, sequence, displayToken: `${queue.service.code}-${String(sequence).padStart(3, "0")}` }, include: tokenInclude });
        await writeHistory(tx as typeof db, created.id, AuditActor.STUDENT, null, TokenStatus.WAITING, "joined", userId);
        return created;
      }, { isolationLevel: "Serializable" });
      const position = await tokenPosition(token);
      if (io) notifyQueue(io, queueId, [userId]);
      return publicToken(token, position);
    } catch (error: any) {
      if ((error?.code === "P2034" || error?.code === "P2002") && attempts < 3) continue;
      throw error;
    }
  }
  throw new AppError(409, "QUEUE_BUSY", "The queue changed just now. Please try joining again.");
}

export async function getQueueSnapshot(queueId: string, includePrivate = false) {
  const queue = await db.queue.findUnique({ where: { id: queueId }, include: { service: { include: { location: true } }, tokens: { where: { status: { in: activeStatuses } }, orderBy: { sequence: "asc" }, include: { user: { select: { id: true, name: true } } } } } });
  if (!queue) throw new AppError(404, "QUEUE_NOT_FOUND", "Queue not found.");
  return { id: queue.id, status: queue.status, service: queue.service, tokens: await Promise.all(queue.tokens.map(async (token) => publicToken({ ...token, queue: { ...queue, service: queue.service } }, await tokenPosition(token)))), private: includePrivate };
}

/** Opens stable check-in windows in persisted data and expires only already-overdue windows. Safe to repeat. */
export async function runQueueScheduler(io?: Realtime) {
  const now = new Date();
  const queues = await db.queue.findMany({ where: { status: QueueStatus.OPEN, sessionKey: sessionKey(now), service: { active: true } }, include: { service: true, tokens: { where: { status: { in: activeStatuses } }, orderBy: { sequence: "asc" } } } });
  let opened = 0; let noShows = 0;
  for (const queue of queues) {
    for (let index = 0; index < queue.tokens.length; index++) {
      const token = queue.tokens[index];
      if (token.status !== TokenStatus.WAITING) continue;
      const position = index;
      if (shouldOpenCheckinWindow(position, queue.service.averageMinutes, queue.service.checkinLeadTokens, queue.service.checkinLeadMinutes)) {
        const windowMs = checkinWindowMs({ demoMode: env.DEMO_MODE, demoWindowMinutes: env.DEMO_CHECKIN_WINDOW_MINUTES, serviceWindowMinutes: queue.service.checkinGraceMinutes });
        const update = await db.token.updateMany({ where: { id: token.id, status: TokenStatus.WAITING }, data: { status: TokenStatus.CHECKIN_REQUIRED, checkinOpenedAt: now, checkinDeadlineAt: new Date(now.getTime() + windowMs) } });
        if (update.count) {
          await db.queueHistory.create({ data: { tokenId: token.id, actorType: AuditActor.SYSTEM, fromStatus: TokenStatus.WAITING, toStatus: TokenStatus.CHECKIN_REQUIRED, action: "checkin_window_opened" } });
          opened++; if (io) notifyQueue(io, queue.id, [token.userId]);
        }
      }
    }
    const expired = await db.token.findMany({ where: { queueId: queue.id, status: TokenStatus.CHECKIN_REQUIRED, checkinDeadlineAt: { lt: now } } });
    for (const token of expired) {
      const update = await db.token.updateMany({ where: { id: token.id, status: TokenStatus.CHECKIN_REQUIRED, checkinDeadlineAt: { lt: now } }, data: { status: TokenStatus.NO_SHOW, reason: "Check-in deadline expired" } });
      if (update.count) {
        await db.queueHistory.create({ data: { tokenId: token.id, actorType: AuditActor.SYSTEM, fromStatus: TokenStatus.CHECKIN_REQUIRED, toStatus: TokenStatus.NO_SHOW, action: "automatic_no_show", reason: "Check-in deadline expired" } });
        noShows++; if (io) notifyQueue(io, queue.id, [token.userId]);
      }
    }
  }
  return { opened, noShows };
}

export async function createQrProof(serviceId: string, queueId: string) {
  const jti = crypto.randomBytes(24).toString("base64url");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + env.QR_TTL_SECONDS * 1000);
  const qrCode = await db.qrCode.create({ data: { serviceId, queueId, jtiHash: crypto.createHash("sha256").update(jti).digest("hex"), expiresAt } });
  const proof = jwt.sign({ serviceId, queueId, jti, purpose: "counter-checkin" }, env.QR_SECRET, { expiresIn: env.QR_TTL_SECONDS, issuer: "queueless-qr" });
  return {
    proof,
    expiresAt,
    id: qrCode.id,
    url: buildCheckInUrl(env.PUBLIC_WEB_URL, proof),
    serverTime: issuedAt.toISOString(),
    rotationSeconds: env.QR_ROTATION_SECONDS,
    allowDemoProof: env.DEMO_MODE && !env.NODE_ENV.startsWith("production")
  };
}

async function logCheckIn(userId: string, result: CheckInResult, tokenId?: string, qrCodeId?: string, reason?: string) {
  await db.checkIn.create({ data: { userId, tokenId, qrCodeId, result, reason } });
}
export async function verifyCheckIn(proof: string, userId: string, io?: Realtime) {
  let raw: jwt.JwtPayload;
  try { raw = jwt.verify(proof, env.QR_SECRET, { issuer: "queueless-qr", clockTolerance: 3 }) as jwt.JwtPayload; }
  catch (error) {
    const expired = error instanceof jwt.TokenExpiredError;
    await logCheckIn(userId, expired ? CheckInResult.EXPIRED : CheckInResult.INVALID_SIGNATURE, undefined, undefined, expired ? "QR proof expired" : "Invalid QR proof signature");
    throw new AppError(400, expired ? "EXPIRED_QR" : "INVALID_QR", expired ? "This counter QR has expired. Please scan the latest code." : "This QR code is invalid. Please scan the counter code again.");
  }
  const parsed = qrPayloadSchema.safeParse(raw);
  if (!parsed.success) { await logCheckIn(userId, CheckInResult.INVALID_SIGNATURE, undefined, undefined, "Malformed QR proof"); throw new AppError(400, "INVALID_QR", "This QR code is invalid."); }
  const payload = parsed.data;
  const now = new Date();
  const qr = await db.qrCode.findFirst({ where: { serviceId: payload.serviceId, queueId: payload.queueId, jtiHash: crypto.createHash("sha256").update(payload.jti).digest("hex"), expiresAt: { gt: now } } });
  if (!qr) { await logCheckIn(userId, CheckInResult.EXPIRED, undefined, undefined, "QR rotation expired"); throw new AppError(400, "EXPIRED_QR", "This QR code has expired. Please scan the current counter code."); }
  const token = await db.token.findFirst({ where: { userId, queueId: payload.queueId, status: { in: [TokenStatus.WAITING, TokenStatus.CHECKIN_REQUIRED, TokenStatus.CHECKED_IN] } }, include: tokenInclude });
  if (!token) { await logCheckIn(userId, CheckInResult.NOT_ELIGIBLE, undefined, qr.id, "No eligible active token"); throw new AppError(409, "NO_ELIGIBLE_TOKEN", "You do not have an eligible token for this counter."); }
  if (token.queue.serviceId !== payload.serviceId) { await logCheckIn(userId, CheckInResult.WRONG_SERVICE, token.id, qr.id, "Token service did not match QR service"); throw new AppError(400, "WRONG_SERVICE", "This QR code is for a different service."); }
  if (token.status === TokenStatus.CHECKED_IN) { await logCheckIn(userId, CheckInResult.DUPLICATE, token.id, qr.id, "Token was already checked in"); throw new AppError(409, "DUPLICATE_CHECKIN", "This token has already been checked in."); }
  if (token.status !== TokenStatus.CHECKIN_REQUIRED || !token.checkinDeadlineAt) { await logCheckIn(userId, CheckInResult.OUT_OF_WINDOW, token.id, qr.id, "Token not in an open check-in window"); throw new AppError(409, "CHECKIN_NOT_OPEN", "Your check-in window is not currently open."); }
  if (token.checkinDeadlineAt <= now) { await logCheckIn(userId, CheckInResult.OUT_OF_WINDOW, token.id, qr.id, "Student check-in deadline expired"); throw new AppError(409, "CHECKIN_DEADLINE_EXPIRED", "Your check-in window has expired. Ask staff to issue a new token if needed."); }
  const result = await db.$transaction(async (tx) => {
    const update = await tx.token.updateMany({ where: { id: token.id, status: TokenStatus.CHECKIN_REQUIRED, checkinDeadlineAt: { gt: new Date() } }, data: { status: TokenStatus.CHECKED_IN, checkedInAt: new Date() } });
    if (!update.count) throw new AppError(409, "DUPLICATE_CHECKIN", "This token has already been checked in or is no longer eligible.");
    await tx.checkIn.create({ data: { userId, tokenId: token.id, qrCodeId: qr.id, result: CheckInResult.SUCCESS } });
    await writeHistory(tx as typeof db, token.id, AuditActor.STUDENT, TokenStatus.CHECKIN_REQUIRED, TokenStatus.CHECKED_IN, "qr_checkin", userId);
    return tx.token.findUniqueOrThrow({ where: { id: token.id }, include: tokenInclude });
  });
  const position = await tokenPosition(result);
  if (io) notifyQueue(io, result.queueId, [userId]);
  return publicToken(result, position);
}

export async function nextEligible(queueId: string, actorId: string, io?: Realtime) {
  const activeServing = await db.token.findFirst({ where: { queueId, status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] } } });
  if (activeServing) throw new AppError(409, "COUNTER_BUSY", "Finish or skip the current token before calling another.");
  const next = await db.token.findFirst({ where: { queueId, status: TokenStatus.CHECKED_IN }, orderBy: { sequence: "asc" } });
  if (!next) throw new AppError(409, "AWAITING_CHECKIN", "No checked-in token is ready. The counter is waiting for check-ins.");
  return transitionToken({ tokenId: next.id, to: TokenStatus.CALLED, actorType: AuditActor.STAFF, actorId, allowedFrom: [TokenStatus.CHECKED_IN], io });
}
