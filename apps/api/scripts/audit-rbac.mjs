#!/usr/bin/env node
/**
 * Every endpoint must declare its access policy explicitly.
 *
 * An endpoint with no `@Public()`, no `@RequirePermissions(...)` and no `@AllowCustomer()`
 * is reachable by any authenticated member of staff — including a helper. That is almost
 * never intended, and it is invisible in review because the absence of a line is what
 * causes it. So it is checked here and in CI.
 *
 * Self-service endpoints (change my own password, who am I) are allowed through by name:
 * they act on the caller and need no permission beyond being signed in.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'modules');

/** Acting on yourself needs no permission beyond authentication. */
const SELF_SERVICE = new Set([
  'POST /auth/logout',
  'GET /auth/me',
  'POST /auth/password',
  'POST /auth/totp/setup',
  'POST /auth/totp/enable',
]);

/** Guarded imperatively because the permission depends on a path parameter. */
const IMPERATIVELY_GUARDED = new Set([
  'POST /import/:entity/preview',
  'POST /import/:entity/commit',
]);

function controllers(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...controllers(path));
    else if (entry.name.endsWith('.controller.ts')) out.push(path);
  }
  return out;
}

const problems = [];
let total = 0;

for (const file of controllers(root)) {
  const src = readFileSync(file, 'utf8');
  const bases = [...src.matchAll(/@Controller\('([^']*)'\)/g)].map((m) => [m.index, m[1]]);
  const baseAt = (pos) => bases.filter(([i]) => i < pos).pop()?.[1] ?? '?';

  // Split the file into per-method chunks: from one handler's decorators to the next.
  // Decorators may sit either side of the HTTP verb, so the whole chunk is searched.
  const verbs = [...src.matchAll(/@(Get|Post|Put|Patch|Delete)\('?([^')]*)'?\)/g)];

  verbs.forEach((m, index) => {
    total += 1;
    const from = index === 0 ? 0 : verbs[index - 1].index;
    const to = index + 1 < verbs.length ? verbs[index + 1].index : src.length;
    const chunk = src.slice(from, to);

    const route = `${m[1].toUpperCase()} /${baseAt(m.index)}/${m[2]}`.replace(/\/+/g, '/').replace(/\/$/, '');
    const key = route.replace(/^(\w+) /, '$1 ');

    const declared =
      /@Public\(\)/.test(chunk) ||
      /@RequirePermissions\(/.test(chunk) ||
      /@AllowCustomer\(\)/.test(chunk);

    if (!declared && !SELF_SERVICE.has(key) && !IMPERATIVELY_GUARDED.has(key)) {
      problems.push(`${key}  (${file.split('/').pop()})`);
    }
  });
}

if (problems.length > 0) {
  console.error(`\n${problems.length} of ${total} endpoints declare no access policy:\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nAdd @RequirePermissions(...), or @Public() if it genuinely needs none, or list it\n' +
      'in SELF_SERVICE in this script if it acts only on the caller.\n',
  );
  process.exit(1);
}

console.log(`RBAC audit: all ${total} endpoints declare an access policy.`);
