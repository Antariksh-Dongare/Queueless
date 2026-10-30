import { describe, expect, it } from "vitest";
import { assertTransition, buildCheckInUrl, canTransition, checkinWindowMs, demoNoShowWindowMs, estimateWaitMinutes, loginPathForCheckIn, operatingDayKey, readCheckInProof, safePostLoginPath, selectFirstCheckedIn, shouldOpenCheckinWindow, stableCheckinDeadline } from "./index.js";

describe("queue domain rules", () => {
  it("allows only the normal verified service path", () => {
    expect(canTransition("WAITING", "CHECKIN_REQUIRED")).toBe(true);
    expect(canTransition("CHECKED_IN", "CALLED")).toBe(true);
    expect(canTransition("WAITING", "CALLED")).toBe(false);
    expect(() => assertTransition("COMPLETED", "WAITING")).toThrow("Invalid token transition");
  });
  it("never produces a negative ETA", () => {
    expect(estimateWaitMinutes(-2, 5)).toBe(0);
    expect(estimateWaitMinutes(3, 4)).toBe(12);
  });
  it("temporarily bypasses an unverified earlier token but selects the earliest verified token", () => {
    expect(selectFirstCheckedIn([{ sequence: 1, status: "CHECKIN_REQUIRED" as const }, { sequence: 2, status: "CHECKED_IN" as const }, { sequence: 3, status: "CHECKED_IN" as const }])?.sequence).toBe(2);
  });
  it("opens by either estimated time or pending-token threshold and preserves its original deadline", () => {
    expect(shouldOpenCheckinWindow(2, 8, 3, 10)).toBe(true);
    expect(shouldOpenCheckinWindow(4, 8, 3, 10)).toBe(false);
    const opened = new Date("2026-10-15T10:00:00Z");
    expect(stableCheckinDeadline(opened, 35).toISOString()).toBe("2026-10-15T10:00:35.000Z");
  });
  it("keeps the normal demo check-in window independent from the accelerated no-show window", () => {
    expect(checkinWindowMs({ demoMode: true, demoWindowMinutes: 15, serviceWindowMinutes: 5 })).toBe(15 * 60_000);
    expect(checkinWindowMs({ demoMode: false, demoWindowMinutes: 15, serviceWindowMinutes: 5 })).toBe(5 * 60_000);
    expect(demoNoShowWindowMs(35)).toBe(35_000);
  });
  it("preserves a URL-encoded QR proof through the safe login redirect", () => {
    const proof = "header.payload_with-url-safe_chars.signature";
    const url = buildCheckInUrl("http://10.252.0.27:5173", proof);
    const parsed = new URL(url);
    expect(parsed.origin).toBe("http://10.252.0.27:5173");
    expect(readCheckInProof(parsed.search)).toBe(proof);
    const loginPath = loginPathForCheckIn(parsed.pathname, parsed.search);
    expect(safePostLoginPath(new URL(`http://local${loginPath}`).search)).toBe(`${parsed.pathname}${parsed.search}`);
    expect(safePostLoginPath("?next=https%3A%2F%2Fevil.example")).toBe("/");
  });
  it("uses the campus operating date rather than the UTC calendar date", () => {
    expect(operatingDayKey(new Date("2026-10-15T18:45:00.000Z"), "Asia/Kolkata")).toBe("2026-10-16");
    expect(operatingDayKey(new Date("2026-10-15T18:15:00.000Z"), "Asia/Kolkata")).toBe("2026-10-15");
  });
});
