import { AuditActor, QueueStatus, Role, TokenStatus } from "./generated/prisma/client.js";
import { db } from "./db.js";
import { hashPassword } from "./auth.js";
import { sessionKey } from "./queue.js";

const password = "Demo@12345";
const records = [
  [Role.ADMIN, "Campus Administrator", "admin@queueless.local"],
  [Role.STAFF, "Mira Kulkarni", "staff@queueless.local"],
  [Role.STUDENT, "Anaya Sharma", "anaya@queueless.local"],
  [Role.STUDENT, "Rahul Mehta", "rahul@queueless.local"],
  [Role.STUDENT, "Priya Nair", "priya@queueless.local"]
] as const;

export async function seedDemo({ reset = false } = {}) {
  if (reset) await db.$transaction([db.checkIn.deleteMany(), db.queueHistory.deleteMany(), db.token.deleteMany(), db.qrCode.deleteMany(), db.queue.deleteMany(), db.staffService.deleteMany(), db.staff.deleteMany(), db.service.deleteMany(), db.location.deleteMany(), db.userSession.deleteMany(), db.user.deleteMany(), db.roleRecord.deleteMany()]);
  for (const role of Object.values(Role)) await db.roleRecord.upsert({ where: { name: role }, update: {}, create: { name: role, description: `${role[0]}${role.slice(1).toLowerCase()} QueueLess role` } });
  for (const [roleName, name, email] of records) await db.user.upsert({ where: { email }, update: { name, roleName, active: true }, create: { name, email, roleName, passwordHash: await hashPassword(password) } });
  const staffUser = await db.user.findUniqueOrThrow({ where: { email: "staff@queueless.local" } });
  const staff = await db.staff.upsert({ where: { userId: staffUser.id }, update: {}, create: { userId: staffUser.id, designation: "Student Services Coordinator" } });
  const location = await db.location.upsert({ where: { id: "11111111-1111-4111-8111-111111111111" }, update: { active: true }, create: { id: "11111111-1111-4111-8111-111111111111", name: "Student Services Centre", building: "Academic Block A", floor: "Ground Floor", description: "Main student support counter" } });
  const serviceData = [
    ["BON", "Bonafide Certificate", "Request and collect a bonafide certificate.", 5],
    ["EXM", "Examination Cell", "Examination forms, marksheets and exam enquiries.", 8],
    ["FEE", "Fees & Accounts", "Fee receipts, account queries and scholarships.", 7],
    ["LIB", "Library Help Desk", "Borrowing, membership and access support.", 4],
    ["ADM", "Admissions Enquiry", "Admission document and application support.", 10],
    ["IDC", "Student ID Card Desk", "New and replacement student ID cards.", 6]
  ] as const;
  const services = [] as { id: string; code: string }[];
  for (const [code, name, description, averageMinutes] of serviceData) {
    const service = await db.service.upsert({ where: { code }, update: { name, description, averageMinutes, locationId: location.id, active: true }, create: { locationId: location.id, code, name, description, averageMinutes } });
    services.push(service);
    await db.staffService.upsert({ where: { staffId_serviceId: { staffId: staff.id, serviceId: service.id } }, update: {}, create: { staffId: staff.id, serviceId: service.id } });
  }
  // Seed only a closed historical sample. Current-day sessions are deliberately
  // administrator-controlled and must never be opened merely by reseeding.
  const historicalSessionKey = sessionKey(new Date(Date.now() - 36 * 60 * 60_000));
  const queue = await db.queue.upsert({ where: { serviceId_sessionKey: { serviceId: services[0].id, sessionKey: historicalSessionKey } }, update: {}, create: { serviceId: services[0].id, sessionKey: historicalSessionKey, status: QueueStatus.CLOSED, openedAt: new Date(Date.now() - 36 * 60 * 60_000), closedAt: new Date(Date.now() - 35 * 60 * 60_000) } });
  const anaya = await db.user.findUniqueOrThrow({ where: { email: "anaya@queueless.local" } });
  const exists = await db.token.count({ where: { queueId: queue.id } });
  if (!exists) {
    const earlier = await db.token.create({ data: { queueId: queue.id, userId: anaya.id, sequence: 1, displayToken: "BON-001", status: TokenStatus.COMPLETED, joinedAt: new Date(Date.now() - 60 * 60_000), checkedInAt: new Date(Date.now() - 55 * 60_000), calledAt: new Date(Date.now() - 54 * 60_000), startedAt: new Date(Date.now() - 53 * 60_000), completedAt: new Date(Date.now() - 48 * 60_000) } });
    await db.queue.update({ where: { id: queue.id }, data: { nextSequence: 2 } });
    await db.queueHistory.create({ data: { tokenId: earlier.id, actorType: AuditActor.SYSTEM, action: "seeded_completed" } });
  }
  return { services: services.length, message: "Demo data seeded." };
}
if (process.argv[1]?.endsWith("seed.ts")) seedDemo().then((result) => { console.log(result.message); }).finally(() => db.$disconnect());
