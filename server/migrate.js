import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { hashPassword, validPassword } from './security.js';
export async function migrate(db, password) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(31001)");
    await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    const existing = await client.query('SELECT id FROM admin_account WHERE id = 1');
    if (!existing.rowCount) {
      if (!validPassword(password)) throw new Error('Initial ADMIN_PASSWORD must contain 12–128 characters.');
      await client.query('INSERT INTO admin_account VALUES (1, $1)', [await hashPassword(password)]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { db } = await import('./db.js');
  try { await migrate(db, process.env.ADMIN_PASSWORD); console.log('Database schema is ready.'); }
  finally { await db.end(); }
}
