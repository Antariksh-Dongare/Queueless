import { execFileSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../../");
const envFile = resolve(root, ".env");
if (!existsSync(envFile)) { copyFileSync(resolve(root, ".env.example"), envFile); console.log("Created .env from .env.example"); }
execFileSync("docker", ["compose", "up", "-d", "postgres"], { cwd: root, stdio: "inherit" });
execFileSync("npm", ["run", "db:migrate"], { cwd: root, stdio: "inherit" });
execFileSync("npm", ["run", "db:seed"], { cwd: root, stdio: "inherit" });
