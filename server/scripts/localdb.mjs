// Private PostgreSQL for local development — runs from server/.pgdata on port 5433.
// Does not touch any PostgreSQL already installed on the machine.
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.pgdata');
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'marketplace',
  password: 'marketplace',
  port: 5433,
  persistent: true,
  // Always UTF-8 (Windows would otherwise default to WIN1252 and reject Urdu, emoji, arrows…)
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) {
  console.log('[db] creating local database cluster…');
  await pg.initialise();
}
await pg.start();
const client = pg.getPgClient();
await client.connect();
const { rows } = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'mandi'`);
if (!rows.length) {
  await client.query(`CREATE DATABASE mandi ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
  console.log('[db] created UTF-8 database "mandi"');
}
await client.end();
console.log('[db] ready on localhost:5433');
const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
