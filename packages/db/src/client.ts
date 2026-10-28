/**
 * The one Prisma client the application uses.
 *
 * Prisma 7 requires a driver adapter; `@prisma/adapter-pg` wraps node-postgres.
 * The pool is sized for a serverless-ish deployment behind a pooler — keep it
 * small per instance and let Neon/PgBouncer do the multiplexing.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { tenantExtension } from "./tenant";

function createBaseClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and start Postgres " +
        "with `pnpm db:up`.",
    );
  }

  const adapter = new PrismaPg({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 10),
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * `globalThis` caching matters in Next.js dev, where module state is re-evaluated
 * on every hot reload — without it you exhaust the connection pool in minutes.
 */
const globalForPrisma = globalThis as unknown as {
  __grainBasketBasePrisma?: PrismaClient;
  __grainBasketDb?: ReturnType<typeof buildExtendedClient>;
};

export function getBaseClient(): PrismaClient {
  if (!globalForPrisma.__grainBasketBasePrisma) {
    globalForPrisma.__grainBasketBasePrisma = createBaseClient();
  }
  return globalForPrisma.__grainBasketBasePrisma;
}

function buildExtendedClient() {
  return getBaseClient().$extends(tenantExtension());
}

/**
 * The scoped client. Use this everywhere — the base client is exported only so
 * the boot canary and migration tooling can reach it, and importing it from
 * `app/` is banned by ESLint.
 */
export function getDb() {
  if (!globalForPrisma.__grainBasketDb) {
    globalForPrisma.__grainBasketDb = buildExtendedClient();
  }
  return globalForPrisma.__grainBasketDb;
}

export type Db = ReturnType<typeof getDb>;
