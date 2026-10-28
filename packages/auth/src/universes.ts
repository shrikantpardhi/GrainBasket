/**
 * The three identity universes and their configuration.
 *
 * Each universe gets its own secret, cookie prefix, base path, session table,
 * and login route. They are never merged into one `User` table with a role
 * column, because the whole security boundary rests on a customer session
 * being structurally incapable of satisfying a platform check.
 *
 * `assertUniversesDistinct()` runs at boot. Sharing a secret or cookie prefix
 * across universes would let a token from one be replayed against another, so
 * this fails the process rather than warning.
 */

import type { ActorUniverse } from "@grain-basket/contracts";

export interface UniverseConfig {
  universe: Extract<ActorUniverse, "CUSTOMER" | "STORE" | "PLATFORM">;
  /** Distinguishes sessions cryptographically; also signs cookies. */
  secret: string;
  cookiePrefix: string;
  basePath: string;
  loginPath: string;
  /** Session lifetime in seconds. */
  sessionTtlSeconds: number;
}

function readSecret(envVar: string, fallbackName: string): string {
  const value = process.env[envVar];
  if (!value || value.length < 16) {
    throw new Error(
      `${envVar} is missing or too short. Set it to a unique 32+ byte random ` +
        `string (openssl rand -base64 32) for the ${fallbackName} universe.`,
    );
  }
  return value;
}

export function getUniverseConfigs(): Record<
  UniverseConfig["universe"],
  UniverseConfig
> {
  return {
    CUSTOMER: {
      universe: "CUSTOMER",
      secret: readSecret("CUSTOMER_AUTH_SECRET", "customer"),
      cookiePrefix: process.env.CUSTOMER_COOKIE_PREFIX ?? "gb_customer",
      basePath: "/api/auth/customer",
      loginPath: "/login",
      sessionTtlSeconds: 30 * 24 * 60 * 60, // 30 days — shoppers stay logged in
    },
    STORE: {
      universe: "STORE",
      secret: readSecret("STORE_AUTH_SECRET", "store"),
      cookiePrefix: process.env.STORE_COOKIE_PREFIX ?? "gb_store",
      basePath: "/api/auth/store",
      loginPath: "/store/login",
      sessionTtlSeconds: 12 * 60 * 60, // a shift
    },
    PLATFORM: {
      universe: "PLATFORM",
      secret: readSecret("PLATFORM_AUTH_SECRET", "platform"),
      cookiePrefix: process.env.PLATFORM_COOKIE_PREFIX ?? "gb_platform",
      basePath: "/api/auth/platform",
      loginPath: "/platform/login",
      sessionTtlSeconds: 8 * 60 * 60,
    },
  };
}

/**
 * Boot assertion. Throws when any two universes share a secret, a cookie
 * prefix, or a base path.
 */
export function assertUniversesDistinct(configs = getUniverseConfigs()): void {
  const list = Object.values(configs);

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;

      if (a.secret === b.secret) {
        throw new Error(
          `Auth universes ${a.universe} and ${b.universe} share a secret. ` +
            `A session token from one would be valid in the other.`,
        );
      }
      if (a.cookiePrefix === b.cookiePrefix) {
        throw new Error(
          `Auth universes ${a.universe} and ${b.universe} share cookie prefix ` +
            `"${a.cookiePrefix}". A browser would send both tokens to both universes.`,
        );
      }
      if (a.basePath === b.basePath) {
        throw new Error(
          `Auth universes ${a.universe} and ${b.universe} share base path "${a.basePath}".`,
        );
      }
    }
  }
}

/** Cookie name for a universe's session token. */
export function sessionCookieName(prefix: string): string {
  return `${prefix}.session`;
}
