import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import argon2 from "argon2";
import { Role } from "./generated/prisma/client.js";
import { db } from "./db.js";
import { env, isProduction } from "./env.js";
import { AppError, asyncRoute } from "./http.js";

export type AuthUser = { id: string; name: string; email: string; role: Role };
declare global { namespace Express { interface Request { user?: AuthUser; sessionId?: string; } } }
const cookieName = "ql_session";
const sessionDays = 7;

export async function hashPassword(password: string) { return argon2.hash(password, { type: argon2.argon2id }); }
export async function verifyPassword(hash: string, password: string) { return argon2.verify(hash, password); }
export async function createSession(user: AuthUser) {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + sessionDays * 86400_000);
  await db.userSession.create({ data: { id, userId: user.id, expiresAt } });
  return jwt.sign({ sub: user.id, sid: id, role: user.role }, env.JWT_SECRET, { expiresIn: `${sessionDays}d`, issuer: "queueless" });
}
export function sessionCookie(token: string) { return { name: cookieName, value: token, options: { httpOnly: true, sameSite: "lax" as const, secure: isProduction || env.COOKIE_SECURE, path: "/", maxAge: sessionDays * 86400_000 } }; }
export function clearSessionCookie() { return { name: cookieName, options: { httpOnly: true, sameSite: "lax" as const, secure: isProduction || env.COOKIE_SECURE, path: "/" } }; }

export const authenticate = asyncRoute(async (req, _res, next) => {
  const token = req.cookies?.[cookieName];
  if (!token) throw new AppError(401, "AUTH_REQUIRED", "Please sign in to continue.");
  let payload: jwt.JwtPayload;
  try { payload = jwt.verify(token, env.JWT_SECRET, { issuer: "queueless" }) as jwt.JwtPayload; } catch { throw new AppError(401, "INVALID_SESSION", "Your session has expired. Please sign in again."); }
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string") throw new AppError(401, "INVALID_SESSION", "Your session is invalid.");
  const session = await db.userSession.findFirst({ where: { id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: true } });
  if (!session || !session.user.active) throw new AppError(401, "INVALID_SESSION", "Your session is no longer active.");
  req.user = { id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.roleName };
  req.sessionId = session.id;
  next();
});
export const optionalAuthenticate: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[cookieName];
  if (!token) return next();
  void (async () => {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET, { issuer: "queueless" }) as jwt.JwtPayload;
      if (!payload.sub || !payload.sid) return next();
      const session = await db.userSession.findFirst({ where: { id: String(payload.sid), userId: String(payload.sub), revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: true } });
      if (session?.user.active) { req.user = { id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.roleName }; req.sessionId = session.id; }
    } catch { /* anonymous remains anonymous */ }
    next();
  })();
};
export const requireRole = (...roles: Role[]): RequestHandler => (req, _res, next) => {
  if (!req.user) return next(new AppError(401, "AUTH_REQUIRED", "Please sign in to continue."));
  if (!roles.includes(req.user.role)) return next(new AppError(403, "FORBIDDEN", "You do not have permission to do that."));
  next();
};
export async function staffCanOperate(userId: string, serviceId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { staffProfile: { include: { assignments: true } } } });
  return user?.roleName === Role.ADMIN || Boolean(user?.staffProfile?.assignments.some((a) => a.serviceId === serviceId));
}
export function readSessionToken(cookieHeader?: string) {
  return cookieHeader?.split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}
export async function authFromToken(token?: string): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { issuer: "queueless" }) as jwt.JwtPayload;
    if (!payload.sub || !payload.sid) return null;
    const session = await db.userSession.findFirst({ where: { id: String(payload.sid), userId: String(payload.sub), revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: true } });
    return session?.user.active ? { id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.roleName } : null;
  } catch { return null; }
}
