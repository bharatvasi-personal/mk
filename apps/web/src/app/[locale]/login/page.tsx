'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorNote, Field, inputClass } from '@/components/ui';
import { useDict, useLocale } from '@/lib/dict';
import { useSession } from '@/lib/session';
import { BRAND_NAME } from '@/lib/config';

export default function LoginPage() {
  const dict = useDict();
  const locale = useLocale();
  const router = useRouter();
  const { signIn, session, loading, can } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (loading || session?.kind !== 'STAFF') return;
    // Land people where they actually work: a helper goes straight to the counter,
    // a partner to the dashboard. Nobody should have to learn a URL.
    router.replace(can('report:sales') ? `/${locale}/admin` : `/${locale}/pos`);
  }, [loading, session, can, locale, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier, password, totpCode || undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.toLowerCase().includes('authenticator')) {
        setNeedsTotp(true);
        setError(null);
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-600 font-display text-2xl font-bold text-white">
          म
        </span>
        <h1 className="mt-3 font-display text-2xl font-semibold text-brand-900">{BRAND_NAME}</h1>
        <p className="text-sm text-ink-600">{dict.auth.signInTitle}</p>
      </div>

      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Field label={dict.auth.identifier}>
            <input
              className={inputClass}
              autoComplete="username"
              autoCapitalize="none"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </Field>

          <Field label={dict.auth.password}>
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          {needsTotp ? (
            <Field label={dict.auth.totp}>
              <input
                className={`${inputClass} text-center text-xl tracking-[0.4em]`}
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
              />
            </Field>
          ) : null}

          <ErrorNote error={error} />

          <Button type="submit" className="w-full" size="lg" disabled={busy}>
            {busy ? dict.auth.signingIn : dict.auth.signIn}
          </Button>
        </form>
      </Card>

      <Link href={`/${locale}`} className="mt-6 text-center text-sm text-ink-400 underline">
        {dict.nav.home}
      </Link>
    </main>
  );
}
