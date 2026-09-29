import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { API_URL, DEFAULT_TENANT } from '@/lib/config';
import { LOCALES } from '@/lib/i18n';

/**
 * Push a menu change to the public site immediately.
 *
 * Without this the site still updates on its own — the public pages revalidate every two
 * minutes — so this is not what makes the site correct, it is what makes it *instant*.
 * That matters at 1:40 pm when the thali runs out and the online store is still selling
 * it: two minutes is eight more orders you cannot fulfil.
 *
 * Authorisation is delegated rather than duplicated: the caller's own access token is
 * checked against the API, and only someone who may edit the menu can trigger this. A
 * shared secret in an env var would have to be readable by the browser to be usable from
 * the admin screen, which makes it not a secret.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ message: 'Not signed in' }, { status: 401 });
  }

  try {
    const me = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: auth, 'X-Tenant': DEFAULT_TENANT },
      cache: 'no-store',
    });
    if (!me.ok) return NextResponse.json({ message: 'Not signed in' }, { status: 401 });

    const body = (await me.json()) as { kind?: string; permissions?: string[] };
    if (body.kind !== 'STAFF' || !body.permissions?.includes('menu:write')) {
      return NextResponse.json({ message: 'Requires menu:write' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ message: 'Could not verify' }, { status: 503 });
  }

  // Every locale, every page that renders menu data.
  const paths = LOCALES.flatMap((locale) => [`/${locale}`, `/${locale}/menu`, `/${locale}/order`]);
  for (const path of paths) revalidatePath(path);

  return NextResponse.json({ revalidated: paths, at: new Date().toISOString() });
}
