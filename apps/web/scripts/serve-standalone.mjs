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
import { spawn } from 'node:child_process';

const root = process.cwd();
const standalone = join(root, '.next/standalone/apps/web');

if (!existsSync(standalone)) {
  console.error('No standalone build found. Run `npm run build -w @mk/web` first.');
  process.exit(1);
}

// Replaced wholesale rather than merged: a leftover file from an older build is the
// thing that causes a mismatched asset hash.
for (const [from, to] of [
  [join(root, '.next/static'), join(standalone, '.next/static')],
  [join(root, 'public'), join(standalone, 'public')],
]) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

console.log('Assembled standalone build. Starting on port', process.env.PORT ?? 3000);

spawn('node', ['server.js'], {
  cwd: standalone,
  stdio: 'inherit',
  env: { ...process.env, PORT: process.env.PORT ?? '3000', HOSTNAME: process.env.HOSTNAME ?? '0.0.0.0' },
});
