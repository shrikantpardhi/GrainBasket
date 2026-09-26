import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(24).toString('hex');
  const digest = await derive(password, salt);
  return `scrypt$${salt}$${digest.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, hex] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hex || !/^[0-9a-f]{128}$/.test(hex)) return false;
  const derived = await derive(password, salt);
  return timingSafeEqual(derived, Buffer.from(hex, 'hex'));
}

export function sessionHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function csrfToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function constantTimeMatch(value: string, expected: string): boolean {
  const received = Buffer.from(value);
  const reference = Buffer.from(expected);
  return received.length === reference.length && timingSafeEqual(received, reference);
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}
