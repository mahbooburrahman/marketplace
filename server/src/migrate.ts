import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function migrate(log = console.log) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`applied ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  log('migrations up to date');
}

// Run only when invoked directly (`npm run migrate` / `node dist/migrate.js`), never when bundled into the server.
if (/migrate\.(ts|js)$/.test(process.argv[1] ?? '')) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
