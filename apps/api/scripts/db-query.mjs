/**
 * Ad-hoc SQL runner against the local dev database.
 *
 * WHY THIS EXISTS: this machine has no `psql` binary (Postgres comes from the
 * `embedded-postgres` npm package), and inlining SQL through `node -e` on
 * PowerShell mangles quotes badly enough to be unusable. This gives a stable
 * way to inspect and repair the dev database while verifying migrations.
 *
 * Usage:
 *   node scripts/db-query.mjs "select 1"          # inline statement
 *   node scripts/db-query.mjs --file path/to.sql  # whole file, one batch
 *
 * DEV ONLY — credentials are the hardcoded local ones from .env.
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Client } = pg;

const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  user: 'bops',
  password: 'bops_dev_password',
  database: 'bops',
});

const args = process.argv.slice(2);
let sql;
if (args[0] === '--file') {
  sql = readFileSync(args[1], 'utf8');
} else {
  sql = args.join(' ');
}

if (!sql?.trim()) {
  console.error('[db-query] no SQL given');
  process.exit(1);
}

await client.connect();
try {
  // A file may contain several statements; node-postgres returns an array then.
  const result = await client.query(sql);
  const results = Array.isArray(result) ? result : [result];
  for (const r of results) {
    if (r.rows?.length) {
      console.log(JSON.stringify(r.rows, null, 2));
    } else {
      console.log(`[db-query] ${r.command ?? 'OK'} (${r.rowCount ?? 0} rows)`);
    }
  }
  console.log('[db-query] OK');
} catch (error) {
  console.error(`[db-query] FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
