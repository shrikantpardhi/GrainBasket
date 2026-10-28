/**
 * Session lifecycle, one function set per universe.
 *
 * There is deliberately no shared `getSession()` that tries each universe in
 * turn. A convenience helper that falls through universes is precisely how the
 * separation collapses: it would let a customer cookie authenticate a store
 * request the first time someone wired it up "just to make it work".
 *
 * Each function takes the universe's table through a small adapter so the
 * caller can't accidentally pass the wrong client.
 */

import { getBaseClient } from "@grain-basket/db";
import { hashSessionToken, newSessionToken } from "./crypto";
import type { UniverseConfig } from "./universes";

export interface CreatedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

type SessionTable = "platformSession" | "storeSession" | "customerSession";

const TABLE_FOR_UNIVERSE: Record<UniverseConfig["universe"], SessionTable> = {
  PLATFORM: "platformSession",
  STORE: "storeSession",
  CUSTOMER: "customerSession",
};

interface SessionRow {
  id: string;
  userId: string;
  expiresAt: Date;
}

/** Sessions live outside the tenant extension: they belong to identity, not a
 *  shop, and must be readable before any scope exists. */
function sessionsTable(config: UniverseConfig) {
  const client = getBaseClient();
  const table = TABLE_FOR_UNIVERSE[config.universe];
  return client[table] as unknown as {
    create(args: {
      data: {
        token: string;
        userId: string;
        expiresAt: Date;
        ipAddress?: string | null;
        userAgent?: string | null;
      };
    }): Promise<SessionRow>;
    findUnique(args: { where: { token: string } }): Promise<SessionRow | null>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
    update?(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<SessionRow>;
  };
}

export async function createSession(
  config: UniverseConfig,
  userId: string,
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<CreatedSession> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1000);

  const row = await sessionsTable(config).create({
    data: {
      token: hashSessionToken(token),
      userId,
      expiresAt,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });

  return { token, sessionId: row.id, expiresAt };
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  expiresAt: Date;
}

/**
 * Resolve a raw token to a session in THIS universe only. A token minted by
 * another universe simply won't be found, which is the separation working.
 */
export async function resolveSession(
  config: UniverseConfig,
  rawToken: string | undefined | null,
): Promise<ResolvedSession | null> {
  if (!rawToken) return null;

  const row = await sessionsTable(config).findUnique({
    where: { token: hashSessionToken(rawToken) },
  });
  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    await sessionsTable(config).deleteMany({ where: { id: row.id } });
    return null;
  }

  return { sessionId: row.id, userId: row.userId, expiresAt: row.expiresAt };
}

/** Revoke one session (sign out). */
export async function revokeSession(
  config: UniverseConfig,
  rawToken: string | undefined | null,
): Promise<void> {
  if (!rawToken) return;
  await sessionsTable(config).deleteMany({
    where: { token: hashSessionToken(rawToken) },
  });
}

/**
 * Revoke every session for a user. Used on offboarding and on
 * `sessionVersion` bumps, so a stolen cookie dies immediately.
 */
export async function revokeAllSessions(
  config: UniverseConfig,
  userId: string,
): Promise<number> {
  const result = await sessionsTable(config).deleteMany({ where: { userId } });
  return result.count;
}
