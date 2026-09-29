import { notFound } from 'next/navigation';
import { LOCALES, isLocale } from '@/lib/i18n';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // `lang` drives the CSS line-height rules for Devanagari and Telugu, and tells screen
  // readers which pronunciation to use.
  return <div lang={locale}>{children}</div>;
}
