import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBaseClient } from "@grain-basket/db";
import {
  hashPassword,
  verifyPassword,
  newSessionToken,
  hashSessionToken,
  newPickupCode,
} from "./crypto";
import {
  getUniverseConfigs,
  assertUniversesDistinct,
  type UniverseConfig,
} from "./universes";
import { createSession, resolveSession, revokeAllSessions, revokeSession } from "./sessions";
import { issueOtp, verifyOtp, assertE164, assertOtpRequestAllowed } from "./otp";

const base = getBaseClient();
const configs = getUniverseConfigs();

let customerId: string;
let storeUserId: string;
let platformUserId: string;

beforeAll(async () => {
  await base.customerSession.deleteMany({ where: { user: { phone: { startsWith: "+9199900" } } } });
  await base.storeSession.deleteMany({ where: { user: { email: { endsWith: "@auth-test.local" } } } });
  await base.platformSession.deleteMany({
    where: { user: { email: { endsWith: "@auth-test.local" } } },
  });
  await base.customer.deleteMany({ where: { phone: { startsWith: "+9199900" } } });
  await base.storeUser.deleteMany({ where: { email: { endsWith: "@auth-test.local" } } });
  await base.platformUser.deleteMany({ where: { email: { endsWith: "@auth-test.local" } } });

  const hash = await hashPassword("correct horse battery staple");
  customerId = (await base.customer.create({ data: { phone: "+919990000001" } })).id;
  storeUserId = (
    await base.storeUser.create({
      data: { email: "staff@auth-test.local", name: "Staff", passwordHash: hash },
    })
  ).id;
  platformUserId = (
    await base.platformUser.create({
      data: {
        email: "admin@auth-test.local",
        name: "Admin",
        passwordHash: hash,
        role: "PLATFORM_ADMIN",
      },
    })
  ).id;
});

afterAll(async () => {
  await base.customerSession.deleteMany({ where: { userId: customerId } });
  await base.storeSession.deleteMany({ where: { userId: storeUserId } });
  await base.platformSession.deleteMany({ where: { userId: platformUserId } });
  await base.customer.deleteMany({ where: { id: customerId } });
  await base.storeUser.deleteMany({ where: { id: storeUserId } });
  await base.platformUser.deleteMany({ where: { id: platformUserId } });
  await base.$disconnect();
});

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("twelve-chars-minimum");
    expect(await verifyPassword("twelve-chars-minimum", hash)).toBe(true);
    expect(await verifyPassword("wrong-password-here", hash)).toBe(false);
  });

  it("produces a different hash for the same password (salted)", async () => {
    const a = await hashPassword("twelve-chars-minimum");
    const b = await hashPassword("twelve-chars-minimum");
    expect(a).not.toBe(b);
  });

  it("enforces a minimum length", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/12 characters/);
  });

  it("rejects a malformed stored hash instead of throwing", async () => {
    expect(await verifyPassword("whatever", "not-a-valid-hash")).toBe(false);
  });
});

describe("universe configuration", () => {
  it("passes the distinctness assertion with the real env", () => {
    expect(() => assertUniversesDistinct(configs)).not.toThrow();
  });

  it("rejects two universes sharing a secret", () => {
    const bad = {
      ...configs,
      STORE: { ...configs.STORE, secret: configs.CUSTOMER.secret },
    };
    expect(() => assertUniversesDistinct(bad)).toThrow(/share a secret/);
  });

  it("rejects two universes sharing a cookie prefix", () => {
    const bad = {
      ...configs,
      PLATFORM: { ...configs.PLATFORM, cookiePrefix: configs.STORE.cookiePrefix },
    };
    expect(() => assertUniversesDistinct(bad)).toThrow(/cookie prefix/);
  });

  it("has three distinct base paths", () => {
    const paths = Object.values(configs).map((c) => c.basePath);
    expect(new Set(paths).size).toBe(3);
  });
});

describe("session isolation between universes", () => {
  it("does not resolve a customer token in the store universe", async () => {
    const created = await createSession(configs.CUSTOMER, customerId);
    const inCustomer = await resolveSession(configs.CUSTOMER, created.token);
    expect(inCustomer?.userId).toBe(customerId);

    const inStore = await resolveSession(configs.STORE, created.token);
    expect(inStore).toBeNull();

    const inPlatform = await resolveSession(configs.PLATFORM, created.token);
    expect(inPlatform).toBeNull();
  });

  it("does not resolve a platform token in the customer universe", async () => {
    const created = await createSession(configs.PLATFORM, platformUserId);
    expect(await resolveSession(configs.PLATFORM, created.token)).not.toBeNull();
    expect(await resolveSession(configs.CUSTOMER, created.token)).toBeNull();
  });

  it("stores only the hash of the token, never the token itself", async () => {
    const created = await createSession(configs.STORE, storeUserId);
    const row = await base.storeSession.findUnique({
      where: { token: created.token },
    });
    expect(row).toBeNull(); // raw token is not a lookup key

    const hashed = await base.storeSession.findUnique({
      where: { token: hashSessionToken(created.token) },
    });
    expect(hashed).not.toBeNull();
  });

  it("revokes one session without touching others", async () => {
    const first = await createSession(configs.CUSTOMER, customerId);
    const second = await createSession(configs.CUSTOMER, customerId);

    await revokeSession(configs.CUSTOMER, first.token);

    expect(await resolveSession(configs.CUSTOMER, first.token)).toBeNull();
    expect(await resolveSession(configs.CUSTOMER, second.token)).not.toBeNull();
  });

  it("revokes every session for a user on offboarding", async () => {
    await createSession(configs.STORE, storeUserId);
    await createSession(configs.STORE, storeUserId);

    const count = await revokeAllSessions(configs.STORE, storeUserId);
    expect(count).toBeGreaterThanOrEqual(1);

    const remaining = await base.storeSession.count({ where: { userId: storeUserId } });
    expect(remaining).toBe(0);
  });

  it("treats an expired session as absent and cleans it up", async () => {
    const shortLived: UniverseConfig = { ...configs.CUSTOMER, sessionTtlSeconds: -1 };
    const created = await createSession(shortLived, customerId);

    expect(await resolveSession(configs.CUSTOMER, created.token)).toBeNull();
    const row = await base.customerSession.findUnique({
      where: { token: hashSessionToken(created.token) },
    });
    expect(row).toBeNull();
  });

  it("returns null for a missing token", async () => {
    expect(await resolveSession(configs.CUSTOMER, undefined)).toBeNull();
    expect(await resolveSession(configs.CUSTOMER, "garbage")).toBeNull();
  });
});

describe("phone OTP", () => {
  it("validates E.164 numbers", () => {
    expect(assertE164("+91 99900 00001")).toBe("+919990000001");
    expect(() => assertE164("9990000001")).toThrow(/valid phone/);
  });

  it("issues and verifies a code", async () => {
    const phone = "+919990000002";
    await base.otpChallenge.deleteMany({ where: { phone } });

    let sent = "";
    await issueOtp({ phone, send: (_p, code) => { sent = code; } });
    expect(sent).toMatch(/^\d{6}$/);

    const result = await verifyOtp(phone, sent);
    expect(result.phone).toBe(phone);
  });

  it("rejects a used code on replay", async () => {
    const phone = "+919990000003";
    await base.otpChallenge.deleteMany({ where: { phone } });

    let sent = "";
    await issueOtp({ phone, send: (_p, code) => { sent = code; } });
    await verifyOtp(phone, sent);

    await expect(verifyOtp(phone, sent)).rejects.toThrow(/No active code/);
  });

  it("invalidates the previous code when a new one is requested", async () => {
    const phone = "+919990000004";
    await base.otpChallenge.deleteMany({ where: { phone } });

    let first = "";
    await issueOtp({ phone, send: (_p, c) => { first = c; } });
    let second = "";
    await issueOtp({ phone, send: (_p, c) => { second = c; } });

    // The superseded code must not authenticate; the live one must.
    await expect(verifyOtp(phone, first)).rejects.toThrow();
    await expect(verifyOtp(phone, second)).resolves.toBeTruthy();
  });

  it("burns the challenge after too many wrong attempts", async () => {
    const phone = "+919990000005";
    await base.otpChallenge.deleteMany({ where: { phone } });

    let sent = "";
    await issueOtp({ phone, send: (_p, c) => { sent = c; } });

    const wrong = sent === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      await expect(verifyOtp(phone, wrong)).rejects.toThrow();
    }
    // Even the correct code no longer works.
    await expect(verifyOtp(phone, sent)).rejects.toThrow();
  });

  it("rate limits repeated code requests", async () => {
    const phone = "+919990000006";
    await base.otpChallenge.deleteMany({ where: { phone } });

    for (let i = 0; i < 5; i++) {
      await issueOtp({ phone, send: () => {} });
    }
    await expect(assertOtpRequestAllowed(phone)).rejects.toThrow(/Too many codes/);
  });

  it("rejects an expired code", async () => {
    const phone = "+919990000007";
    await base.otpChallenge.deleteMany({ where: { phone } });

    let sent = "";
    await issueOtp({ phone, send: (_p, c) => { sent = c; } });
    await base.otpChallenge.updateMany({
      where: { phone },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(verifyOtp(phone, sent)).rejects.toThrow(/expired/);
  });
});

describe("pickup codes", () => {
  it("avoids visually ambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = newPickupCode(6);
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    }
  });

  it("generates distinct tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => newSessionToken()));
    expect(tokens.size).toBe(100);
  });
});
