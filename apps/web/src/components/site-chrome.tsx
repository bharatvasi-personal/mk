'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LOCALE_LABELS } from '@mk/shared';
import { LOCALES, switchLocalePath } from '@/lib/i18n';
import { useDict, useLocale } from '@/lib/dict';
import { BRAND_NAME, SHOP } from '@/lib/config';

export function SiteHeader() {
  const dict = useDict();
  const locale = useLocale();
  const pathname = usePathname();

  const links = [
    { href: `/${locale}`, label: dict.nav.home },
    { href: `/${locale}/menu`, label: dict.nav.menu },
    { href: `/${locale}/visit`, label: dict.nav.contact },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-brand-50/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        <Link href={`/${locale}`} className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 font-display text-lg font-bold text-white">
            म
          </span>
          <span className="font-display text-lg font-semibold text-brand-800">{BRAND_NAME}</span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 sm:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                pathname === l.href ? 'bg-brand-100 text-brand-800' : 'text-ink-600 hover:bg-brand-100/60'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <LocaleSwitcher />
          <Link
            href={`/${locale}/order`}
            className="pos-tap rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            {dict.nav.orderOnline}
          </Link>
        </div>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto border-t border-brand-100 px-4 py-2 sm:hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
              pathname === l.href ? 'bg-brand-100 text-brand-800' : 'text-ink-600'
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function LocaleSwitcher() {
  const pathname = usePathname();
  const locale = useLocale();
  return (
    <div className="flex items-center rounded-lg border border-ink-200 bg-white p-0.5">
      {LOCALES.map((l) => (
        <Link
          key={l}
          href={switchLocalePath(pathname, l)}
          // A visitor who cannot read the current language must still be able to find
          // their own, so each option is labelled in its own script.
          lang={l}
          aria-current={l === locale ? 'true' : undefined}
          className={`rounded px-2 py-1 text-xs font-medium ${
            l === locale ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100'
          }`}
        >
          {l === 'en' ? 'EN' : LOCALE_LABELS[l]}
        </Link>
      ))}
    </div>
  );
}

export function SiteFooter() {
  const dict = useDict();
  const locale = useLocale();
  return (
    <footer className="mt-16 border-t border-ink-200 bg-white">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <div className="font-display text-lg font-semibold text-brand-800">{BRAND_NAME}</div>
          <p className="mt-2 text-sm text-ink-600">{dict.brand.tagline}</p>
        </div>
        <div>
          <div className="text-sm font-semibold text-ink-800">{dict.home.findUsTitle}</div>
          <address className="mt-2 not-italic text-sm text-ink-600">
            {SHOP.addressLines.map((l) => (
              <div key={l}>{l}</div>
            ))}
            <a className="mt-2 inline-block text-brand-700 underline" href={`tel:${SHOP.phone.replace(/\s/g, '')}`}>
              {SHOP.phone}
            </a>
          </address>
        </div>
        <div>
          <div className="text-sm font-semibold text-ink-800">{dict.home.hoursTitle}</div>
          <ul className="mt-2 space-y-1 text-sm text-ink-600">
            {SHOP.hours.map((h) => (
              <li key={h.label}>
                <span className="text-ink-800">{h.label}:</span> {h.value}
              </li>
            ))}
          </ul>
          <Link href={`/${locale}/login`} className="mt-4 inline-block text-xs text-ink-400 underline">
            {dict.nav.staffLogin}
          </Link>
        </div>
      </div>
    </footer>
  );
}

export function WhatsAppCta({ text }: { text: string }) {
  return (
    <a
      href={`https://wa.me/${SHOP.whatsapp}?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noreferrer noopener"
      className="pos-tap inline-flex items-center gap-2 rounded-lg border border-leaf-500 px-4 py-2 font-medium text-leaf-600 hover:bg-leaf-100"
    >
      WhatsApp
    </a>
  );
}
