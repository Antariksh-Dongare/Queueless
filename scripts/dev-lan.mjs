import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

function detectedLanIp() {
  const entries = Object.entries(networkInterfaces()).flatMap(([name, addresses]) => (addresses ?? []).map(({ family, internal, address }) => ({ name, family, internal, address })));
  const candidates = entries.filter((entry) => entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."));
  const preferred = candidates.find(({ name }) => /^en0$/i.test(name)) ?? candidates.find(({ name }) => /^en\d+$/i.test(name)) ?? candidates[0];
  return preferred?.address;
}

const ip = process.env.QUEUELESS_LAN_IP || detectedLanIp();
if (!ip && !process.env.PUBLIC_WEB_URL) {
  console.error("Could not find a LAN IPv4 address. Re-run with QUEUELESS_LAN_IP=YOUR_MAC_IP npm run dev:lan.");
  process.exit(1);
}
const publicWebUrl = process.env.PUBLIC_WEB_URL || `http://${ip}:5173`;
console.log(`QueueLess LAN URL: ${publicWebUrl}`);
const child = spawn("npm", ["run", "dev"], { stdio: "inherit", env: { ...process.env, PUBLIC_WEB_URL: publicWebUrl } });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
