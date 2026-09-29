import { en, type Dictionary } from './en';
import { hi } from './hi';
import { te } from './te';

export const LOCALES = ['en', 'hi', 'te'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  hi: 'हिन्दी',
  te: 'తెలుగు',
};

export const dictionaries: Record<Locale, Dictionary> = { en, hi, te };

export function getDictionary(locale: string | undefined): Dictionary {
  if (locale && (LOCALES as readonly string[]).includes(locale)) {
    return dictionaries[locale as Locale];
  }
  return dictionaries[DEFAULT_LOCALE];
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Pick a localised value out of a `*I18n` JSONB column, falling back to the base
 * column. Menu items get Hindi/Telugu names as data, not as code.
 */
export function pickI18n(
  base: string,
  i18n: Record<string, string> | null | undefined,
  locale: string,
): string {
  const v = i18n?.[locale];
  return v && v.trim() ? v : base;
}

export type { Dictionary };
export { en, hi, te };
