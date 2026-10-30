import { defineConfig } from "@playwright/test";

const live = Boolean(process.env.E2E_DATABASE_URL);
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: live ? [
    { command: "DATABASE_URL=$E2E_DATABASE_URL npm run prisma:migrate -w @queueless/api && DATABASE_URL=$E2E_DATABASE_URL npm run prisma:seed -w @queueless/api && DATABASE_URL=$E2E_DATABASE_URL npm run dev -w @queueless/api", url: "http://localhost:4000/api/health", reuseExistingServer: false, timeout: 60_000 },
    { command: "npm run dev -w @queueless/web", url: "http://localhost:5173", reuseExistingServer: false, timeout: 30_000 }
  ] : undefined
});
