import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  void _next;
  if (error instanceof ZodError) return res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Please correct the highlighted fields.", fields: error.flatten().fieldErrors } });
  if (error instanceof AppError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "P2002") return res.status(409).json({ error: { code: "DUPLICATE", message: "That record already exists." } });
  console.error("Unhandled request error", error instanceof Error ? error.message : "unknown");
  return res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } });
}
