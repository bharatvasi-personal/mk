#!/usr/bin/env node
/**
 * Applies the hand-written SQL in prisma/sql in order.
 *
 * These are not Prisma migrations on purpose: 02_rls.sql discovers tables at run
 * time, so it must be re-applied after every schema migration to cover new tables.
 * `npm run db:security` is therefore part of the deploy, right after `migrate deploy`.
 *
 * Connects with DATABASE_MIGRATION_URL (the privileged owner role) because creating
 * roles, policies and triggers is not something the app role may do.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, '..', 'prisma', 'sql');
const rawUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;

if (!rawUrl) {
  console.error('Set DATABASE_MIGRATION_URL (preferred) or DATABASE_URL.');
  process.exit(1);
}

// Prisma accepts `?schema=` and `?connection_limit=`; libpq does not. Strip anything
// psql would reject so one connection string can serve both tools.
const url = (() => {
  const u = new URL(rawUrl);
  for (const key of [...u.searchParams.keys()]) {
    if (!['sslmode', 'application_name', 'connect_timeout'].includes(key)) {
      u.searchParams.delete(key);
    }
  }
  return u.toString().replace(/\?$/, '');
})();

const files = readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();
const appPassword = process.env.POSTGRES_APP_PASSWORD ?? 'mk_app_dev_password';

for (const file of files) {
  const body = readFileSync(join(sqlDir, file), 'utf8');
  // 01_roles.sql reads the app password from a session setting rather than having it
  // interpolated into SQL text, so it never lands in a log or in shell history.
  const prelude = file.startsWith('01_') ? `SET mk.app_password = '${appPassword}';\n` : '';
  process.stdout.write(`→ ${file} … `);
  try {
    execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], {
      input: prelude + body,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    console.error(err.stderr?.toString() || err.message);
    process.exit(1);
  }
}
console.log('\nDatabase security objects applied. Re-run this after every migration.');
