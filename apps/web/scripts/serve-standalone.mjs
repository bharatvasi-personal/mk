#!/usr/bin/env node
/**
 * Runs the production build locally the way the container does.
 *
 * `output: "standalone"` emits a traced server that does NOT include `.next/static` or
 * `public` — the Dockerfile copies both in as separate steps. Locally that assembly was
 * being done by hand, and doing it by hand across repeated in-place rebuilds produced a
 * half-populated tree that served one build's HTML with another build's assets. Which
 * looks exactly like the app being broken, and is not.
 *
 *   npm run start:local -w @mk/web
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const root = process.cwd();
const standalone = join(root, '.next/standalone/apps/web');

if (!existsSync(standalone)) {
  console.error('No standalone build found. Run `npm run build -w @mk/web` first.');
  process.exit(1);
}

// Replaced wholesale rather than merged: a leftover file from an older build is the
// thing that causes a mismatched asset hash.
//
// `.next/server/app` is in this list because Next does NOT refresh prerendered HTML
// inside an existing standalone tree on an in-place rebuild. Leaving it stale serves the
// previous build's pages — the same class of bug as the year-long stale-while-revalidate,
// and just as confusing, because the build says it succeeded and the site does not change.
for (const [from, to] of [
  [join(root, '.next/static'), join(standalone, '.next/static')],
  [join(root, '.next/server/app'), join(standalone, '.next/server/app')],
  [join(root, 'public'), join(standalone, 'public')],
]) {
  if (!existsSync(from)) continue;
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

const port = process.env.PORT ?? '3000';

// A previous run still holding the port is the single most confusing failure here: the new
// server exits on EADDRINUSE, the old one keeps answering, and the site appears not to have
// picked up the rebuild at all. Same symptom as a stale asset tree, different cause.
try {
  const held = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
    .split('\n')
    .map((l) => Number(l.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  for (const pid of held) {
    console.log(`Port ${port} was held by pid ${pid} — stopping it first.`);
    process.kill(pid, 'SIGTERM');
  }
  if (held.length) await new Promise((r) => setTimeout(r, 1000));
} catch {
  // lsof exits non-zero when nothing is listening, which is the normal case.
}

console.log('Assembled standalone build. Starting on port', port);

spawn('node', ['server.js'], {
  cwd: standalone,
  stdio: 'inherit',
  env: { ...process.env, PORT: port, HOSTNAME: process.env.HOSTNAME ?? '0.0.0.0' },
});
