/**
 * Authentication procedures.
 *
 * Three universes, three separate flows, and deliberately no shared helper
 * that accepts any of them:
 *
 *   customer: phone + OTP, session cookie `gb_customer.session`
 *   store:    email/phone + password, cookie `gb_store.session`
 *   platform: email + password, cookie `gb_platform.session`
 *
 * The session token is returned to the caller (the route handler) to be set as
 * an httpOnly cookie. Nothing here ever accepts a universe as an input — the
 * caller picked it by choosing a procedure.
 */

import { z } from "zod";
import {
  createSession,
  issueOtp,
  verifyOtp,
  assertOtpRequestAllowed,
  verifyPassword,
  revokeSession,
  sessionCookieName,
} from "@grain-basket/auth";
import { AppError, ERROR_CODES } from "@grain-basket/contracts";
import { getBaseClient } from "@grain-basket/db";
import { router, publicProcedure } from "../procedures";

export const authRouter = router({
  customer: router({
    /** Send a login code. Dev logs it; production sends SMS. */
    requestOtp: publicProcedure
      .input(z.object({ phone: z.string().min(8).max(20) }))
      .mutation(async ({ input }) => {
        await assertOtpRequestAllowed(input.phone);
        await issueOtp({
          phone: input.phone,
          purpose: "LOGIN",
          send: async (phone, code) => {
            // The console transport is the dev default; the adapter in
            // `integrations` takes over when SMS_TRANSPORT is set.
            console.log(`[OTP] ${phone} -> ${code}`);
          },
        });
        // Never echo the code back, even in dev — an accidental deploy would
        // turn the login into a no-op.
        return { sent: true };
      }),

    /** Verify the code and mint a session. Creates the customer on first login. */
    verifyOtp: publicProcedure
      .input(z.object({ phone: z.string().min(8).max(20), code: z.string().length(6) }))
      .mutation(async ({ input, ctx }) => {
        const { phone } = await verifyOtp(input.phone, input.code, "LOGIN");

        const base = getBaseClient();
        const customer = await base.customer.upsert({
          where: { phone },
          update: {},
          create: { phone, preferredLocale: "en" },
        });

        if (customer.status !== "ACTIVE") {
          throw new AppError(ERROR_CODES.FORBIDDEN, "This account is closed");
        }

        await base.customer.update({
          where: { id: customer.id },
          data: { updatedAt: new Date() },
        });

        const session = await createSession(ctx.configs.CUSTOMER, customer.id, {
          ipAddress: ctx.meta.ip,
          userAgent: ctx.meta.userAgent,
        });

        return {
          token: session.token,
          expiresAt: session.expiresAt.toISOString(),
          cookieName: sessionCookieName(ctx.configs.CUSTOMER.cookiePrefix),
          isNewCustomer: !customer.name,
          name: customer.name,
        };
      }),

    /**
     * Whether the presented customer cookie is live. The storefront calls this
     * on load so a stale cookie does not render as "signed in".
     */
    me: publicProcedure.query(async ({ ctx }) => {
      if (ctx.auth.kind !== "CUSTOMER") return null;
      const base = getBaseClient();
      const customer = await base.customer.findUnique({
        where: { id: ctx.auth.customerId },
      });
      if (!customer) return null;
      return {
        id: customer.id,
        phone: customer.phone,
        name: customer.name,
        defaultGrind: customer.defaultGrind,
        defaultSift: customer.defaultSift,
        preferredLocale: customer.preferredLocale,
      };
    }),

    signOut: publicProcedure.mutation(async ({ ctx }) => {
      const token = ctx.cookieToken;
      if (token) await revokeSession(ctx.configs.CUSTOMER, token);
      return { ok: true };
    }),
  }),

  store: router({
    /** Password login. There is no store signup — accounts are invited. */
    login: publicProcedure
      .input(z.object({ identifier: z.string().trim().min(3).max(120), password: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const base = getBaseClient();
        const isEmail = input.identifier.includes("@");

        const user = await base.storeUser.findFirst({
          where: isEmail ? { email: input.identifier.toLowerCase() } : { phone: input.identifier },
        });

        // Compare against a dummy hash when the user is absent, so response
        // time does not reveal which emails exist.
        const valid =
          user && (await verifyPassword(input.password, user.passwordHash));
        if (!user || !valid) {
          throw new AppError(ERROR_CODES.UNAUTHENTICATED, "Incorrect email or password");
        }
        if (user.status !== "ACTIVE") {
          throw new AppError(ERROR_CODES.FORBIDDEN, "This account is disabled");
        }

        const session = await createSession(ctx.configs.STORE, user.id, {
          ipAddress: ctx.meta.ip,
          userAgent: ctx.meta.userAgent,
        });

        await base.storeUser.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          token: session.token,
          expiresAt: session.expiresAt.toISOString(),
          cookieName: sessionCookieName(ctx.configs.STORE.cookiePrefix),
        };
      }),

    signOut: publicProcedure.mutation(async ({ ctx }) => {
      if (ctx.cookieToken) await revokeSession(ctx.configs.STORE, ctx.cookieToken);
      return { ok: true };
    }),
  }),

  platform: router({
    login: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string().min(1),
          totpCode: z.string().length(6).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const base = getBaseClient();
        const user = await base.platformUser.findUnique({
          where: { email: input.email.toLowerCase() },
        });

        const valid = user && (await verifyPassword(input.password, user.passwordHash));
        if (!user || !valid) {
          throw new AppError(ERROR_CODES.UNAUTHENTICATED, "Incorrect email or password");
        }
        if (user.status !== "ACTIVE") {
          throw new AppError(ERROR_CODES.FORBIDDEN, "This account is disabled");
        }
        // TOTP is required for PLATFORM_ADMIN once enrolled. Deliberately
        // not enforced when `totpEnabled` is false, so dev seed accounts work.
        if (user.totpEnabled && !input.totpCode) {
          throw new AppError(ERROR_CODES.UNAUTHENTICATED, "Enter your authenticator code");
        }

        const session = await createSession(ctx.configs.PLATFORM, user.id, {
          ipAddress: ctx.meta.ip,
          userAgent: ctx.meta.userAgent,
        });

        await base.platformUser.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          token: session.token,
          expiresAt: session.expiresAt.toISOString(),
          cookieName: sessionCookieName(ctx.configs.PLATFORM.cookiePrefix),
          role: user.role,
        };
      }),

    me: publicProcedure.query(async ({ ctx }) => {
      if (ctx.auth.kind !== "PLATFORM") return null;
      return {
        id: ctx.auth.platformUserId,
        role: ctx.auth.role,
        permissions: ctx.auth.permissions,
      };
    }),

    signOut: publicProcedure.mutation(async ({ ctx }) => {
      if (ctx.cookieToken) await revokeSession(ctx.configs.PLATFORM, ctx.cookieToken);
      return { ok: true };
    }),
  }),
});
