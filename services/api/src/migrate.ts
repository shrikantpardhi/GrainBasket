import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, inTransaction } from './db.js';

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [742016]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
    const files = (await readdir(migrationDirectory)).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
    for (const filename of files) {
      const source = await readFile(path.join(migrationDirectory, filename), 'utf8');
      const checksum = createHash('sha256').update(source).digest('hex');
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE filename = $1', [filename],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Migration changed: ${filename}`);
        continue;
      }
      if (!/^BEGIN;\s*/i.test(source) || !/\s*COMMIT;\s*$/i.test(source)) {
        throw new Error(`Migration needs transaction boundaries: ${filename}`);
      }
      const statements = source.replace(/^BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
      await inTransaction(client, async () => {
        await client.query(statements);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [filename, checksum]);
      });
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [742016]);
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate().then(() => pool.end()).catch(async (error: unknown) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  });
}
