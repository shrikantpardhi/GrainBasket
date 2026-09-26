import pg, { type PoolClient } from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function inTransaction<T>(client: PoolClient, run: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await run();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
