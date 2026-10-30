import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { Role } from "./generated/prisma/client.js";
import { authFromToken, readSessionToken } from "./auth.js";
import { db } from "./db.js";

export function createRealtime(server: HttpServer) {
  const io = new Server(server, { path: "/socket.io", cors: { origin: false, credentials: true } });
  io.use(async (socket, next) => {
    const user = await authFromToken(readSessionToken(socket.handshake.headers.cookie));
    if (!user) return next(new Error("Unauthorized"));
    socket.data.user = user;
    next();
  });
  io.on("connection", (socket) => {
    const user = socket.data.user as { id: string; role: Role };
    socket.join(`user:${user.id}`);
    socket.on("queue:subscribe", async ({ queueId }: { queueId: string }) => {
      const queue = await db.queue.findUnique({ where: { id: queueId }, include: { service: { include: { assignments: true } } } });
      if (!queue) return;
      const staff = user.role === Role.STAFF ? await db.staff.findUnique({ where: { userId: user.id }, include: { assignments: true } }) : null;
      const assigned = staff?.assignments.some((assignment) => assignment.serviceId === queue.serviceId) ?? false;
      if (user.role === Role.ADMIN || assigned) socket.join(`queue:${queueId}`);
    });
  });
  return io;
}
export type Realtime = ReturnType<typeof createRealtime>;
export function notifyQueue(io: Realtime, queueId: string, userIds: string[] = []) {
  io.to(`queue:${queueId}`).emit("queue:updated", { queueId });
  for (const userId of userIds) io.to(`user:${userId}`).emit("token:updated", { queueId });
}

/** Session status contains no private data and lets dashboards discover a newly opened queue. */
export function notifySessions(io: Realtime, queueId?: string) {
  io.emit("sessions:updated", { queueId });
}
