import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, inTransaction } from './db.js';
import { hashPassword } from './security.js';

export async function bootstrapAdmin(): Promise<void> {
  const login = process.env.ADMIN_LOGIN?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!login || !password || password.length < 12) {
    throw new Error('ADMIN_LOGIN and ADMIN_PASSWORD (at least 12 characters) are required');
  }
  const client = await pool.connect();
  try {
    await inTransaction(client, async () => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [742017]);
      const admins = await client.query('SELECT id FROM staff_accounts WHERE role = $1 LIMIT 1', ['ADMIN']);
      if (admins.rows.length) throw new Error('An administrator already exists');

      const stores = await client.query<{ id: string }>('SELECT id FROM stores ORDER BY id');
      let storeId: string;
      if (stores.rows.length) {
        const requestedId = process.env.ADMIN_STORE_ID;
        if (!requestedId || !stores.rows.some((store) => store.id === requestedId)) {
          throw new Error('Set ADMIN_STORE_ID to an existing store');
        }
        storeId = requestedId;
      } else {
        const name = process.env.ADMIN_STORE_NAME?.trim();
        const address = process.env.ADMIN_STORE_ADDRESS?.trim();
        const phone = process.env.ADMIN_STORE_PHONE?.trim();
        if (!name || !address || !phone) {
          throw new Error('ADMIN_STORE_NAME, ADMIN_STORE_ADDRESS and ADMIN_STORE_PHONE are required');
        }
        const inserted = await client.query<{ id: string }>(
          'INSERT INTO stores (name, address, contact_phone) VALUES ($1, $2, $3) RETURNING id',
          [name, address, phone],
        );
        storeId = inserted.rows[0]!.id;
      }
      await client.query(
        `INSERT INTO staff_accounts (store_id, login_name, password_hash, role)
         VALUES ($1, $2, $3, 'ADMIN')`,
        [storeId, login, await hashPassword(password)],
      );
    });
  } finally {
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  bootstrapAdmin().then(() => {
    console.log('Administrator created');
    return pool.end();
  }).catch(async (error: unknown) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  });
}
