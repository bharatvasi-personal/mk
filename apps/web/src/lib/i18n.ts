import { LOCALES, type Locale, getDictionary, isLocale } from '@mk/shared';

export { LOCALES, isLocale, getDictionary };
export type { Locale };

/**
 * Locale lives in the URL (`/en`, `/hi`, `/te`) rather than in a cookie, because the
 * public menu has to be indexable in all three and a shared WhatsApp link must open in
 * the language the sender was reading.
 */
export function resolveLocale(value: string | undefined): Locale {
  return value && isLocale(value) ? value : 'en';
}

export function switchLocalePath(pathname: string, next: Locale): string {
  const parts = pathname.split('/');
  if (parts[1] && isLocale(parts[1])) {
    parts[1] = next;
    return parts.join('/');
  }
  return `/${next}${pathname}`;
}
