/**
 * Customer phone-OTP login.
 *
 * Rules that matter for a real Indian consumer app:
 *   - Rate limited per phone AND per IP, so an attacker can't enumerate
 *     numbers or burn an SMS bill in a loop.
 *   - Codes are hashed at rest and expire in 5 minutes.
 *   - A wrong code increments `attempts`; at 5 the challenge is burnt, so a
 *     six-digit code can't be brute-forced within its lifetime.
 *   - Requesting a new code invalidates the previous one.
 */

import { getBaseClient } from "@grain-basket/db";
import { AppError, ERROR_CODES } from "@grain-basket/contracts";
import { codesMatch, hashOtp, newOtpCode } from "./crypto";

const OTP_TTL_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;

interface OtpRow {
  id: string;
  phone: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

function otpTable() {
  return getBaseClient().otpChallenge as unknown as {
    create(args: {
      data: {
        phone: string;
        codeHash: string;
        expiresAt: Date;
        purpose: string;
      };
    }): Promise<OtpRow>;
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc">;
    }): Promise<OtpRow | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<OtpRow>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
}

export interface IssueOtpInput {
  phone: string;
  /** Called with the plaintext code. The console transport logs it in dev. */
  send: (phone: string, code: string) => Promise<void> | void;
  purpose?: string;
}

export async function issueOtp(input: IssueOtpInput): Promise<{ expiresAt: Date }> {
  const phone = assertE164(input.phone);
  const purpose = input.purpose ?? "LOGIN";

  // Burn any live challenge so the previous code stops working the moment a
  // new one is requested.
  await otpTable().updateMany({
    where: { phone, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = newOtpCode(6);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  await otpTable().create({
    data: { phone, codeHash: hashOtp(phone, code), expiresAt, purpose },
  });

  await input.send(phone, code);
  return { expiresAt };
}

export interface VerifyOtpResult {
  phone: string;
}

export async function verifyOtp(
  phoneInput: string,
  code: string,
  purpose = "LOGIN",
): Promise<VerifyOtpResult> {
  const phone = assertE164(phoneInput);

  const challenge = await otpTable().findFirst({
    where: { phone, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, "No active code for this number");
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new AppError(ERROR_CODES.SESSION_EXPIRED, "This code has expired");
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many attempts; request a new code");
  }

  if (!codesMatch(hashOtp(phone, code), challenge.codeHash)) {
    const attempts = challenge.attempts + 1;
    const data: Record<string, unknown> = { attempts };
    // Burn the challenge on the final failed attempt. Crucially this only ever
    // SETS consumedAt — writing null here would resurrect an already-consumed
    // challenge, letting a stale code be retried.
    if (attempts >= MAX_ATTEMPTS) data.consumedAt = new Date();

    await otpTable().update({ where: { id: challenge.id }, data });
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, "Incorrect code");
  }

  // Consume atomically: a replayed verify must not mint a second session.
  const consumed = await otpTable().updateMany({
    where: { id: challenge.id, consumedAt: null, attempts: challenge.attempts },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) {
    throw new AppError(ERROR_CODES.CONFLICT, "This code was already used");
  }

  return { phone };
}

/** Send-rate guard: how many codes a number may request in a window. */
export async function assertOtpRequestAllowed(
  phone: string,
  windowMinutes = 15,
  maxPerWindow = 5,
): Promise<void> {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const recent = await otpTable().count({
    where: { phone: assertE164(phone), createdAt: { gte: since } },
  });
  if (recent >= maxPerWindow) {
    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      `Too many codes requested. Try again in ${windowMinutes} minutes.`,
    );
  }
}

/** Loose E.164 validation — India is +91 but the app is not India-only forever. */
export function assertE164(phone: string): string {
  const cleaned = phone.replace(/[\s-()]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, `Not a valid phone number: ${phone}`);
  }
  return cleaned;
}
