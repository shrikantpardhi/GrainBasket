import { z } from 'zod';

export const id = z.string().regex(/^[1-9][0-9]*$/);
export const money = z.string().regex(/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,2})?$/);
export const text = z.string().trim().min(1).max(250);
export const language = z.enum(['en', 'hi', 'mr']);
export const translations = z.object({ en: text, hi: text, mr: text }).strict();
export const evidenceUrl = z.string().url().refine((value) => value.startsWith('https://'), 'Use an HTTPS link');

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
