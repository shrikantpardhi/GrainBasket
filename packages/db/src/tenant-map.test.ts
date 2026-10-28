/**
 * Model-coverage test.
 *
 * The tenant extension only scopes models listed in TENANT_MODELS. If someone
 * adds `shopId` to a new table and forgets the map, every query on that table
 * runs unscoped and nothing fails. This test reads schema.prisma and asserts
 * the map is complete, so that mistake fails CI instead of shipping.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TENANT_MODELS, GLOBAL_SHARED_MODELS } from "./tenant";

const SCHEMA_PATH = join(process.cwd(), "prisma", "schema.prisma");

/** Parse "model X { ... }" blocks and report which declare a shopId column. */
function modelsWithShopId(): { model: string; nullable: boolean }[] {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const results: { model: string; nullable: boolean }[] = [];

  const modelRegex = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match: RegExpExecArray | null;

  while ((match = modelRegex.exec(schema)) !== null) {
    const [, name, body] = match;
    if (!name || !body) continue;
    // Match a field declaration line starting with shopId.
    const fieldLine = body
      .split("\n")
      .find((line) => /^\s*shopId\s+/.test(line));
    if (fieldLine) {
      results.push({ model: name, nullable: /String\?/.test(fieldLine) });
    }
  }

  return results;
}

describe("tenant model map coverage", () => {
  it("scopes every model that declares a non-nullable shopId", () => {
    const declared = modelsWithShopId().filter((m) => !m.nullable);
    const mapped = new Set([...Object.keys(TENANT_MODELS), ...Object.keys(GLOBAL_SHARED_MODELS)]);

    const unmapped = declared.filter((m) => !mapped.has(m.model)).map((m) => m.model);

    expect(
      unmapped,
      `These models declare shopId but are missing from TENANT_MODELS in tenant.ts, ` +
        `so queries on them would run unscoped: ${unmapped.join(", ")}`,
    ).toEqual([]);
  });

  it("scopes every model with a nullable shopId as globally shared", () => {
    const declared = modelsWithShopId().filter((m) => m.nullable);
    const globalSet = new Set(Object.keys(GLOBAL_SHARED_MODELS));

    const unmapped = declared.filter((m) => !globalSet.has(m.model)).map((m) => m.model);

    expect(
      unmapped,
      `These models have a nullable shopId (meaning "global") but are not in ` +
        `GLOBAL_SHARED_MODELS, so store scopes could not read the global rows: ` +
        `${unmapped.join(", ")}`,
    ).toEqual([]);
  });

  it("does not list models that no longer exist", () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    const existing = new Set(
      Array.from(schema.matchAll(/model\s+(\w+)\s*\{/g)).map((m) => m[1] as string),
    );

    const stale = [...Object.keys(TENANT_MODELS), ...Object.keys(GLOBAL_SHARED_MODELS)].filter(
      (m) => !existing.has(m),
    );
    expect(stale, `Stale entries in the tenant map: ${stale.join(", ")}`).toEqual([]);
  });
});
