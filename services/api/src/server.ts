import { pool } from './db.js';
import { createApp } from './app.js';

const secret = process.env.SESSION_SECRET;
if (!process.env.DATABASE_URL || !secret) throw new Error('DATABASE_URL and SESSION_SECRET are required');
const app = createApp(pool, {
  sessionSecret: secret,
  allowedOrigin: process.env.PUBLIC_ORIGIN,
  secureCookies: process.env.NODE_ENV === 'production',
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, '0.0.0.0', () => console.log(`API listening on ${port}`));
