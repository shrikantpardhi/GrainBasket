import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 keeps CLI configuration here rather than in schema.prisma.
 *
 * In production, `DATABASE_URL` is the pooled Neon connection (PgBouncer) used
 * by the app at runtime; migrations need a direct connection, which is what
 * `DIRECT_URL` provides. Prisma 7 removed `directUrl` from the datasource
 * block, so the CLI always uses `datasource.url` — point it at the direct
 * connection when running migrations (see the migrate scripts).
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
