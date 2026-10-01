'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import type { Permission } from '@mk/shared';
import { useDict, useLocale } from '@/lib/dict';
import { useSession } from '@/lib/session';
import { Button } from './ui';

/**
 * Wraps every staff screen: waits for the session, bounces anyone who should not be
 * here, and renders the branch picker.
 *
 * The guard is here rather than in middleware because the access token lives in memory
 * (not in a cookie the edge could read) — which is the same decision that makes an XSS
 * unable to steal it.
 */
export function StaffShell({
  children,
  requires,
  title,
  actions,
  banner,
  wide = false,
  flush = false,
}: {
  children: ReactNode;
  requires?: Permission;
  title?: string;
  actions?: ReactNode;
  /** Full-bleed strip between the nav and the content — the POS shift bar lives here. */
  banner?: ReactNode;
  wide?: boolean;
  /** Drop the main padding, for screens that manage their own full-height layout. */
  flush?: boolean;
}) {
  const { session, loading, can, branches, branchId, setBranchId, signOut } = useSession();
  const dict = useDict();
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (session?.kind !== 'STAFF') router.replace(`/${locale}/login`);
  }, [loading, session, locale, router]);

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-ink-400">{dict.common.loading}</div>;
  }
  if (session?.kind !== 'STAFF') return null;

  if (requires && !can(requires)) {
    return (
      <div className="grid min-h-screen place-items-center px-4 text-center">
        <div>
          <p className="text-lg font-medium text-ink-800">{dict.auth.noAccess}</p>
          <p className="mt-1 text-sm text-ink-400">Requires: {requires}</p>
          <Button className="mt-4" variant="secondary" onClick={() => router.push(`/${locale}/pos`)}>
            {dict.pos.title}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white">
        <div className={`mx-auto flex items-center gap-3 px-4 py-2.5 ${wide ? '' : 'max-w-7xl'}`}>
          <Link href={`/${locale}/admin`} className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 font-display font-bold text-white">
              म
            </span>
          </Link>
          {title ? <h1 className="font-display text-lg font-semibold text-ink-900">{title}</h1> : null}

          <div className="ml-auto flex items-center gap-2">
            {actions}
            {branches.length > 1 ? (
              <select
                aria-label={dict.common.branch}
                className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm"
                value={branchId ?? ''}
                onChange={(e) => setBranchId(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="hidden text-sm text-ink-400 sm:inline">{branches[0]?.name}</span>
            )}
            <span className="hidden text-sm text-ink-600 sm:inline">{session.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await signOut();
                router.replace(`/${locale}/login`);
              }}
            >
              {dict.nav.signOut}
            </Button>
          </div>
        </div>
      </header>
      <StaffNav />
      {banner}
      <main className={`${flush ? '' : 'mx-auto px-4 py-6'} ${wide || flush ? '' : 'max-w-7xl'}`}>
        {children}
      </main>
    </div>
  );
}

function StaffNav() {
  const { can } = useSession();
  const dict = useDict();
  const locale = useLocale();
  const pathname = usePathname();

  const items = ([
    { href: `/${locale}/pos`, label: dict.pos.title, permission: 'order:create' },
    { href: `/${locale}/kitchen`, label: dict.pos.kitchen, permission: 'kitchen:read' },
    { href: `/${locale}/admin`, label: dict.admin.dashboard, permission: 'report:sales' },
    { href: `/${locale}/admin/orders`, label: dict.admin.orders, permission: 'order:read' },
    { href: `/${locale}/admin/subscriptions`, label: 'Subscriptions', permission: 'subscription:read' },
    { href: `/${locale}/admin/inventory`, label: dict.admin.inventory, permission: 'inventory:read' },
    { href: `/${locale}/admin/purchasing`, label: dict.admin.purchasing, permission: 'vendor:read' },
    { href: `/${locale}/admin/staff`, label: dict.admin.staff, permission: 'employee:read' },
    { href: `/${locale}/admin/attendance`, label: dict.admin.attendance, permission: 'attendance:read:all' },
    { href: `/${locale}/admin/legal`, label: dict.admin.legal, permission: 'legal:read' },
    { href: `/${locale}/admin/expenses`, label: dict.admin.expenses, permission: 'expense:read' },
    { href: `/${locale}/admin/reports`, label: dict.admin.reports, permission: 'report:cost' },
    { href: `/${locale}/admin/menu`, label: dict.admin.menu, permission: 'menu:write' },
    { href: `/${locale}/admin/import`, label: dict.admin.import, permission: 'inventory:write' },
    { href: `/${locale}/admin/branches`, label: dict.admin.branches, permission: 'branch:read' },
    { href: `/${locale}/admin/audit`, label: dict.admin.audit, permission: 'audit:read' },
  ] satisfies { href: string; label: string; permission?: Permission }[]).filter(
    (i) => !i.permission || can(i.permission),
  );

  return (
    <nav className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-1.5">
        {items.map((i) => {
          const active = pathname === i.href;
          return (
            <Link
              key={i.href}
              href={i.href}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? 'bg-brand-100 text-brand-800' : 'text-ink-600 hover:bg-ink-100'
              }`}
            >
              {i.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
