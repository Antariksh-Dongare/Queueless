import { env, isProduction } from "../env.js";
import { db } from "../db.js";
import { seedDemo } from "../seed.js";

if (isProduction || !env.DEMO_MODE) throw new Error("Refusing demo reset: it only runs with NODE_ENV!=production and DEMO_MODE=true.");
seedDemo({ reset: true }).then(() => console.log("Local demo data reset.")).finally(() => db.$disconnect());
