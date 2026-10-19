/**
 * Local development database, no Docker required.
 *
 * WHY THIS EXISTS: docker-compose.yml is the intended local stack, but this
 * machine has no Docker and no local Postgres, which means every claim about
 * the API "working" would be unverified compile output. This script runs a real
 * PostgreSQL server from the `embedded-postgres` package so migrations, guards
 * and tenant isolation can actually be exercised.
 *
 * IT IS NOT A PRODUCTION PATH. Production and CI use docker-compose / a managed
 * instance; this only ever binds to 127.0.0.1 with dev credentials that already
 * live in .env.
 *
 * Usage:
 *   node scripts/dev-db.mjs start   # start (idempotent) and stay running
 *   node scripts/dev-db.mjs stop
 *   node scripts/dev-db.mjs status
 */

import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..');
const dataDir = resolve(apiRoot, '.dev-db');

const HOST = process.env.POSTGRES_HOST ?? '127.0.0.1';
const PORT = Number(process.env.POSTGRES_PORT ?? 5432);
const USER = process.env.POSTGRES_USER ?? 'bops';
const PASSWORD = process.env.POSTGRES_PASSWORD ?? 'bops_dev_password';
const DATABASE = process.env.POSTGRES_DB ?? 'bops';

/** True when the PostgreSQL server is actually accepting the project's auth and schema URL. */
async function isDatabaseReachable() {
  try {
    const { Client } = await import('pg');
    const client = new Client({
      host: HOST,
      port: PORT,
      user: USER,
      password: PASSWORD,
      database: DATABASE,
      connectionTimeoutMillis: 1500,
      statement_timeout: 1500,
    });

    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function start() {
  if (await isDatabaseReachable()) {
    console.log(`[dev-db] PostgreSQL is reachable on ${PORT} — reusing it`);
    return;
  }

  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    // NON-NEGOTIABLE for this product. On Windows, initdb defaults the cluster
    // to WIN1252, which cannot represent a single Persian character: every
    // INSERT carrying Persian text dies with 22P05 "no equivalent in encoding
    // WIN1252". Encoding is fixed at initdb time and CANNOT be altered later —
    // getting it wrong means deleting .dev-db and starting over. locale C keeps
    // initdb from re-deriving a 1252 collation from the host's regional setting.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // Suppress the server's own English log spam; failures still surface as
    // thrown errors from initialise/start.
    onLog: () => {},
  });

  // initialise() is only valid on an empty directory. `PG_VERSION` is written by
  // initdb, so its presence is the reliable "already initialised" signal —
  // checking for the directory itself is not, since we may have just created it.
  const alreadyInitialised = existsSync(resolve(dataDir, 'PG_VERSION'));
  if (!alreadyInitialised) {
    console.log('[dev-db] initialising cluster (first run, ~20s)…');
    await pg.initialise();
  }

  await pg.start();
  console.log(`[dev-db] server up on ${HOST}:${PORT}`);

  try {
    await pg.createDatabase(DATABASE);
    console.log(`[dev-db] created database "${DATABASE}"`);
  } catch {
    // Already exists on a repeat run. Not an error worth failing the script for.
    console.log(`[dev-db] database "${DATABASE}" already present`);
  }

  // Extensions the Prisma schema declares. citext and btree_gist ship with
  // core Postgres; postgis does NOT and is therefore attempted but tolerated —
  // BM-05 proximity search is out of scope for BM-01 verification.
  const client = pg.getPgClient();
  await client.connect();
  try {
    for (const extension of ['citext', 'pgcrypto', 'btree_gist']) {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "${extension}"`);
      console.log(`[dev-db] extension ready: ${extension}`);
    }
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS "postgis"');
      console.log('[dev-db] extension ready: postgis');
    } catch {
      console.log(
        '[dev-db] postgis NOT available in this build — fine for BM-01, needed for BM-05',
      );
    }
  } finally {
    await client.end();
  }

  console.log('[dev-db] ready. Press Ctrl+C to stop.');

  const shutdown = async () => {
    console.log('\n[dev-db] stopping…');
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive; the server dies with it.
  await new Promise(() => {});
}

async function status() {
  const ready = await isDatabaseReachable();
  console.log(ready ? `[dev-db] PostgreSQL reachable on ${PORT}` : '[dev-db] not ready');
  process.exit(ready ? 0 : 1);
}

const command = process.argv[2] ?? 'start';
if (command === 'status') {
  await status();
} else if (command === 'start') {
  await start();
} else {
  console.error(`[dev-db] unknown command: ${command}`);
  process.exit(1);
}
