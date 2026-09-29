'use client';

import { usePathname } from 'next/navigation';
import { getDictionary, pickI18n } from '@mk/shared';
import { resolveLocale, type Locale } from './i18n';

/**
 * Dictionary access for client components.
 *
 * Read from the URL rather than threaded through props, because the locale is already
 * the first path segment and every client component below it needs the same value.
 */
export function useLocale(): Locale {
  const pathname = usePathname();
  return resolveLocale(pathname.split('/')[1]);
}

export function useDict() {
  return getDictionary(useLocale());
}

/** Localised name for a record carrying a `*I18n` JSONB column. */
export function useI18nText() {
  const locale = useLocale();
  return (base: string, i18n: Record<string, string> | null | undefined) => pickI18n(base, i18n, locale);
}
