import { z } from "zod";

export const Roles = ["STUDENT", "STAFF", "ADMIN"] as const;
export type Role = (typeof Roles)[number];
export const TokenStatuses = ["WAITING", "CHECKIN_REQUIRED", "CHECKED_IN", "CALLED", "SERVING", "COMPLETED", "NO_SHOW", "CANCELLED", "SKIPPED"] as const;
export type TokenStatus = (typeof TokenStatuses)[number];
export const ActiveTokenStatuses: TokenStatus[] = ["WAITING", "CHECKIN_REQUIRED", "CHECKED_IN", "CALLED", "SERVING"];

const transitionMap: Record<TokenStatus, readonly TokenStatus[]> = {
  WAITING: ["CHECKIN_REQUIRED", "CANCELLED"],
  CHECKIN_REQUIRED: ["CHECKED_IN", "NO_SHOW", "CANCELLED"],
  CHECKED_IN: ["CALLED", "CANCELLED"],
  CALLED: ["SERVING", "SKIPPED"],
  SERVING: ["COMPLETED", "SKIPPED"],
  COMPLETED: [], NO_SHOW: [], CANCELLED: [], SKIPPED: []
};

export function canTransition(from: TokenStatus, to: TokenStatus) {
  return transitionMap[from].includes(to);
}

export function assertTransition(from: TokenStatus, to: TokenStatus) {
  if (!canTransition(from, to)) throw new Error(`Invalid token transition: ${from} → ${to}`);
}

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(128)
});
export const loginSchema = z.object({ email: z.email().trim().toLowerCase(), password: z.string().min(1).max(128) });
export const locationSchema = z.object({ name: z.string().trim().min(2).max(80), building: z.string().trim().min(1).max(80), floor: z.string().trim().min(1).max(40), description: z.string().trim().max(500).optional(), active: z.boolean().optional() });
export const serviceSchema = z.object({
  locationId: z.uuid(), name: z.string().trim().min(2).max(100), code: z.string().trim().regex(/^[A-Z]{2,5}$/),
  description: z.string().trim().max(500), averageMinutes: z.number().int().min(1).max(120), active: z.boolean().optional()
});
export const policySchema = z.object({ checkinLeadMinutes: z.number().int().min(1).max(60), checkinLeadTokens: z.number().int().min(1).max(20), checkinGraceMinutes: z.number().int().min(1).max(60) });
export const qrPayloadSchema = z.object({ serviceId: z.uuid(), queueId: z.uuid(), jti: z.string().min(16), purpose: z.literal("counter-checkin") });

/** Builds the exact URL encoded in a counter QR. The proof is decoded once by URLSearchParams on the confirmation page. */
export function buildCheckInUrl(publicWebUrl: string, proof: string) {
  const url = new URL("/check-in/confirm", publicWebUrl);
  url.searchParams.set("proof", proof);
  return url.toString();
}

export function readCheckInProof(search: string) {
  const proof = new URLSearchParams(search).get("proof");
  return proof?.trim() || null;
}

export function loginPathForCheckIn(pathname: string, search: string) {
  return `/login?next=${encodeURIComponent(`${pathname}${search}`)}`;
}

/** Prevent a login redirect parameter from becoming an external/open redirect. */
export function safePostLoginPath(search: string) {
  const next = new URLSearchParams(search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function estimateWaitMinutes(ahead: number, averageMinutes: number) {
  return Math.max(0, Math.ceil(Math.max(0, ahead) * Math.max(1, averageMinutes)));
}

export function shouldOpenCheckinWindow(position: number, averageMinutes: number, leadTokens: number, leadMinutes: number) {
  return position < Math.max(1, leadTokens) || estimateWaitMinutes(position, averageMinutes) <= Math.max(1, leadMinutes);
}
export function stableCheckinDeadline(openedAt: Date, graceSeconds: number) {
  return new Date(openedAt.getTime() + Math.max(1, graceSeconds) * 1000);
}

export function checkinWindowMs(input: { demoMode: boolean; demoWindowMinutes: number; serviceWindowMinutes: number }) {
  const minutes = input.demoMode ? input.demoWindowMinutes : input.serviceWindowMinutes;
  return Math.max(1, minutes) * 60_000;
}

export function demoNoShowWindowMs(seconds: number) {
  return Math.max(1, seconds) * 1000;
}

/**
 * Returns an immutable operating-day key from a real instant. Timestamps stay
 * in UTC in PostgreSQL; only the session boundary is evaluated in the campus
 * timezone so an India midnight cannot be mistaken for a UTC rollover.
 */
export function operatingDayKey(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
export function selectFirstCheckedIn<T extends { sequence: number; status: TokenStatus }>(tokens: T[]) {
  return tokens.filter((token) => token.status === "CHECKED_IN").sort((a, b) => a.sequence - b.sequence)[0] ?? null;
}

export type ApiError = { error: { code: string; message: string; fields?: Record<string, string> } };
