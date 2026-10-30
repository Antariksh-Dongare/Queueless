import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { qrPayloadSchema } from "@queueless/shared";

describe("QR proof cryptography", () => {
  const secret = "test-secret-that-is-only-for-unit-verification";
  const payload = { serviceId: "11111111-1111-4111-8111-111111111111", queueId: "22222222-2222-4222-8222-222222222222", jti: "a-long-enough-rotation-identifier", purpose: "counter-checkin" as const };
  it("accepts a signed proof and rejects tampering", () => {
    const proof = jwt.sign(payload, secret, { expiresIn: "30s", issuer: "queueless-qr" });
    expect(qrPayloadSchema.safeParse(jwt.verify(proof, secret, { issuer: "queueless-qr" })).success).toBe(true);
    expect(() => jwt.verify(`${proof}x`, secret, { issuer: "queueless-qr" })).toThrow();
  });
  it("rejects an expired proof", () => {
    const proof = jwt.sign(payload, secret, { expiresIn: -1, issuer: "queueless-qr" });
    expect(() => jwt.verify(proof, secret, { issuer: "queueless-qr" })).toThrow("jwt expired");
  });
});
