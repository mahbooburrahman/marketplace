import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgres://marketplace:marketplace@localhost:5433/postgres' });
await c.connect();
const { rows } = await c.query(`SELECT 1 FROM pg_database WHERE datname = 'mandi'`);
if (!rows.length) await c.query(`CREATE DATABASE mandi ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
const r = await c.query(`SELECT datname, pg_encoding_to_char(encoding) enc FROM pg_database WHERE datname='mandi'`);
console.log(JSON.stringify(r.rows));
await c.end();
