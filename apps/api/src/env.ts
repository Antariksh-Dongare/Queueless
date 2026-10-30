import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(24),
  QR_SECRET: z.string().min(24),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:5173"),
  /** Comma-separated exact browser origins for a non-standard local setup. */
  ALLOWED_ORIGINS: z.string().optional(),
  /** The operating-day boundary for queue sessions; timestamps themselves remain UTC. */
  CAMPUS_TIME_ZONE: z.string().default("Asia/Kolkata").refine((value) => {
    try { new Intl.DateTimeFormat("en-GB", { timeZone: value }); return true; } catch { return false; }
  }, "CAMPUS_TIME_ZONE must be a valid IANA timezone"),
  COOKIE_SECURE: z.string().optional().transform((v) => v === "true"),
  DEMO_MODE: z.string().optional().transform((v) => v === "true"),
  /** Normal demo tokens receive this window; it is independent of the manual no-show scenario. */
  DEMO_CHECKIN_WINDOW_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  /** Only the administrator's explicit demo no-show action uses this accelerated window. */
  DEMO_NO_SHOW_GRACE_SECONDS: z.coerce.number().int().min(15).max(120).default(35),
  QR_ROTATION_SECONDS: z.coerce.number().int().min(30).max(180).default(60),
  QR_TTL_SECONDS: z.coerce.number().int().min(45).max(180).default(75)
});
export const env = schema.parse(process.env);
export const isProduction = env.NODE_ENV === "production";
