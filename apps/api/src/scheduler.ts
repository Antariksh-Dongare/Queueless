import type { Realtime } from "./realtime.js";
import { runQueueScheduler } from "./queue.js";

export function startScheduler(io: Realtime) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runQueueScheduler(io); } catch (error) { console.error("Queue scheduler failed", error instanceof Error ? error.message : "unknown error"); } finally { running = false; }
  };
  void tick();
  const handle = setInterval(() => void tick(), 3_000);
  return () => clearInterval(handle);
}
