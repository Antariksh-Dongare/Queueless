import { describe, expect, it } from "vitest";
import { allowedRequestOrigins, isAllowedRequestOrigin } from "./origin.js";

describe("development request origins", () => {
  it("allows the configured LAN address and exact local development origins only", () => {
    const origins = allowedRequestOrigins("http://10.252.0.27:5173", "development");
    expect(isAllowedRequestOrigin("http://10.252.0.27:5173", origins)).toBe(true);
    expect(isAllowedRequestOrigin("http://localhost:5173", origins)).toBe(true);
    expect(isAllowedRequestOrigin("http://127.0.0.1:5173", origins)).toBe(true);
    expect(isAllowedRequestOrigin("http://10.252.0.99:5173", origins)).toBe(false);
    expect(isAllowedRequestOrigin("https://evil.example", origins)).toBe(false);
  });
  it("does not implicitly allow localhost in production", () => {
    const origins = allowedRequestOrigins("https://queue.example.edu", "production");
    expect(isAllowedRequestOrigin("https://queue.example.edu", origins)).toBe(true);
    expect(isAllowedRequestOrigin("http://localhost:5173", origins)).toBe(false);
  });
});
