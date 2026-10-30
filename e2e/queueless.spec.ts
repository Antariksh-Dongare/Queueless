import { test, expect } from "@playwright/test";

const live = Boolean(process.env.E2E_DATABASE_URL);
test.skip(!live, "Set E2E_DATABASE_URL to an isolated PostgreSQL database to run destructive browser workflows.");

async function demoLogin(page: import("@playwright/test").Page, button: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: button }).click();
}

test("administrator closes and reopens only today's queue without creating a duplicate, then staff sees its QR", async ({ browser }) => {
  const adminContext = await browser.newContext(); const admin = await adminContext.newPage();
  await demoLogin(admin, "Administrator");
  const service = await admin.evaluate(async () => (await fetch("/api/admin/services")).json().then((body) => body.services.find((entry: { code: string }) => entry.code === "BON")));
  expect(service).toBeTruthy();
  const beforeId = service.queues[0].id;
  const closed = await admin.evaluate(async (id) => fetch(`/api/admin/services/${id}/queue/close`, { method: "POST", headers: { "Content-Type": "application/json" } }).then(async (response) => ({ status: response.status, body: await response.json() })), service.id);
  expect(closed.status).toBe(200);
  expect(closed.body.queue.status).toBe("CLOSED");
  const opened = await admin.evaluate(async (id) => fetch(`/api/admin/services/${id}/queue/open`, { method: "POST", headers: { "Content-Type": "application/json" } }).then(async (response) => ({ status: response.status, body: await response.json() })), service.id);
  expect(opened.status).toBe(200);
  expect(opened.body.queue.status).toBe("OPEN");
  expect(opened.body.queue.id).toBe(beforeId);
  const idempotent = await admin.evaluate(async (id) => fetch(`/api/admin/services/${id}/queue/open`, { method: "POST", headers: { "Content-Type": "application/json" } }).then((response) => response.json()), service.id);
  expect(idempotent.action).toBe("already_open");
  expect(idempotent.queue.id).toBe(beforeId);
  await expect(admin.getByText("Open queues")).toBeVisible();

  const staffContext = await browser.newContext(); const staff = await staffContext.newPage();
  await demoLogin(staff, "Staff · Mira");
  await expect(staff.getByRole("heading", { name: "Service desk" })).toBeVisible();
  await expect(staff.getByLabel("Select service queue")).toContainText("Bonafide Certificate · OPEN");
  const qr = await staff.evaluate(async (id) => fetch(`/api/staff/services/${id}/qr`).then(async (response) => ({ status: response.status, body: await response.json() })), service.id);
  expect(qr.status).toBe(200);
  expect(qr.body.url).toMatch(/\/check-in\/confirm\?proof=/);
  await staffContext.close(); await adminContext.close();
});

test("student joins, preserves a LAN-style QR proof through login, checks in, and staff receives the update", async ({ browser }) => {
  const studentContext = await browser.newContext(); const student = await studentContext.newPage();
  await demoLogin(student, "Student · Anaya");
  await expect(student.getByRole("heading", { name: "Your campus queues" })).toBeVisible();
  const bon = await student.evaluate(async () => (await fetch("/api/services")).json().then((body) => body.services.find((entry: { code: string }) => entry.code === "BON")));
  expect(bon?.queue?.status).toBe("OPEN");
  const joined = await student.evaluate(async (queueId) => fetch(`/api/queues/${queueId}/tokens`, { method: "POST", headers: { "Content-Type": "application/json" } }).then(async (response) => ({ status: response.status, body: await response.json() })), bon.queue.id);
  expect(joined.status).toBe(201);
  await student.reload();
  await expect(student.getByText(/Active token/)).toBeVisible();

  const staffContext = await browser.newContext(); const staff = await staffContext.newPage();
  await demoLogin(staff, "Staff · Mira");
  await expect(staff.getByRole("heading", { name: "Service desk" })).toBeVisible();
  const staffBon = await staff.evaluate(async () => (await fetch("/api/staff/services")).json().then((body) => body.services.find((entry: { code: string }) => entry.code === "BON")));
  await staff.getByLabel("Select service queue").selectOption(staffBon.queue.id);
  await expect(staff.locator('a[title="Open authenticated check-in"]')).toBeVisible();
  const qrUrl = await staff.locator('a[title="Open authenticated check-in"]').getAttribute("href");
  expect(qrUrl).toMatch(/\/check-in\/confirm\?proof=/);

  const scannerContext = await browser.newContext(); const scanner = await scannerContext.newPage();
  await scanner.goto(qrUrl!);
  await expect(scanner).toHaveURL(/\/login\?next=/);
  await scanner.getByRole("button", { name: "Student · Anaya" }).click();
  await expect(scanner).toHaveURL(/\/check-in\/confirm\?proof=/);
  await scanner.getByRole("button", { name: "Confirm check-in" }).click();
  await expect(scanner.getByText("Check-in confirmed. You are eligible to be called.")).toBeVisible();
  await expect(staff.getByText("Checked in").first()).toBeVisible();
  await scannerContext.close(); await staffContext.close(); await studentContext.close();
});

test("logout clears the session and mobile student portal remains usable", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } }); const page = await context.newPage();
  await demoLogin(page, "Student · Anaya");
  await expect(page.getByRole("heading", { name: "Your campus queues" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  const protectedStatus = await page.evaluate(() => fetch("/api/tokens/me").then((response) => response.status));
  expect(protectedStatus).toBe(401);
  await context.close();
});
