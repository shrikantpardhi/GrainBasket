/**
 * Password hashing and opaque session tokens.
 *
 * Passwords use scrypt (memory-hard, in Node core — no native build step).
 * Session tokens are random 32-byte values; only their SHA-256 is stored, so a
 * database leak does not hand out live sessions.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;
/** Keep scrypt cost high enough to matter but low enough for a mill's server. */
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const derived = await scrypt(password, salt, expected.length);

  // Constant-time compare: a length mismatch is itself a failure, and
  // timingSafeEqual throws on differing lengths.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Minimum policy. Deliberately modest: a long passphrase beats a short
 * symbol-soup password, and store staff are typing on a counter tablet.
 */
export function assertPasswordPolicy(password: string): void {
  if (password.length < 12) {
    throw new Error("Password must be at least 12 characters");
  }
  if (password.length > 256) {
    throw new Error("Password must be at most 256 characters");
  }
}

/** A new opaque session token. Returned to the client; never stored raw. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash a session token for storage/lookup. Fast: the token is already random. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Numeric OTP of `digits` length, uniformly distributed. */
export function newOtpCode(digits = 6): string {
  const max = 10 ** digits;
  // Rejection sampling avoided by reading 4 bytes and taking modulo only when
  // the range divides evenly; for 6 digits the bias over 2^32 is negligible
  // but we still reject out-of-range draws.
  for (;;) {
    const n = randomBytes(4).readUInt32BE(0);
    if (n < Math.floor(0xffffffff / max) * max) return String(n % max).padStart(digits, "0");
  }
}

/** Constant-time comparison for OTP codes. */
export function codesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Hash an OTP for storage. OTPs are short, so we salt with the phone number. */
export function hashOtp(phone: string, code: string): string {
  return createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

/** Hash a bearer invite token for storage. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** URL-safe random token for invites and pickup codes. */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * A pickup code a customer reads at the counter. Excludes characters that are
 * easily confused aloud (0/O, 1/I/L).
 */
export function newPickupCode(length = 6): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}
