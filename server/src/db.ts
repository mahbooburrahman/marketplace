import pg from 'pg';
import { config } from './config.js';

// Return NUMERIC as JS number (prices fit comfortably), BIGINT counts as number.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// DATE columns stay as 'YYYY-MM-DD' strings (no timezone shifting).
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX ?? 10),
});

export type Queryable = pg.Pool | pg.PoolClient;

/** Parameterised query helper — every SQL statement in the app goes through $n placeholders. */
export async function q<T = any>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T[]> {
  const res = await db.query(text, params as any[]);
  return res.rows as T[];
}

export async function one<T = any>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T | null> {
  const rows = await q<T>(text, params, db);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
