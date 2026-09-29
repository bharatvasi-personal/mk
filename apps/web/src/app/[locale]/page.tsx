import Link from 'next/link';
import type { Metadata } from 'next';
import { getDictionary, pickI18n, formatMinor } from '@mk/shared';
import { SiteFooter, SiteHeader, WhatsAppCta } from '@/components/site-chrome';
import { ThaliIllustration } from '@/components/thali-illustration';
import { BRAND_NAME, SHOP } from '@/lib/config';
import { serverGet, type PublicBranch, type PublicMenuCategory } from '@/lib/server-api';
import { resolveLocale } from '@/lib/i18n';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return {
    title: `${dict.brand.tagline} | ${BRAND_NAME}, Tellapur`,
    description: dict.home.heroBody,
    alternates: {
      canonical: `/${locale}`,
      languages: { en: '/en', hi: '/hi', te: '/te' },
    },
  };
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const dict = getDictionary(locale);

  const branches = (await serverGet<PublicBranch[]>('/public/branches')) ?? [];
  const branch = branches[0];
  const lunch = branch
    ? ((await serverGet<PublicMenuCategory[]>(`/public/menu/${branch.id}?mealSlot=LUNCH`)) ?? [])
    : [];

  const thali = lunch.flatMap((c) => c.items).slice(0, 4);

  // JSON-LD so Google can show the address, hours and price range directly in results.
  // For a neighbourhood food business, the search result *is* the shopfront.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: BRAND_NAME,
    description: dict.home.heroBody,
    servesCuisine: ['North Indian', 'Bihari', 'Mithila', 'Chinese'],
    priceRange: '₹₹',
    telephone: SHOP.phone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: branch?.addressLine1 ?? SHOP.addressLines[0],
      addressLocality: branch?.city ?? 'Hyderabad',
      addressRegion: branch?.state ?? 'Telangana',
      postalCode: branch?.pincode ?? '502300',
      addressCountry: 'IN',
    },
    geo:
      branch?.lat && branch?.lng
        ? { '@type': 'GeoCoordinates', latitude: branch.lat, longitude: branch.lng }
        : undefined,
    openingHoursSpecification: [
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '07:00', closes: '22:30' },
    ],
    hasMenu: { '@type': 'Menu', url: `/${locale}/menu` },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader />

      <main>
        <section className="bg-gradient-to-b from-brand-50 to-ink-50">
          <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1.2fr_1fr]">
            <div>
            <p className="mb-3 text-sm font-medium uppercase tracking-widest text-brand-600">
              {branch?.name ?? 'Osman Nagar'} · Tellapur
            </p>
            <h1 className="max-w-2xl font-display text-4xl font-bold leading-tight text-brand-900 sm:text-5xl">
              {dict.home.heroTitle}
            </h1>
            <p className="mt-4 max-w-xl text-lg text-ink-600">{dict.home.heroBody}</p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href={`/${locale}/menu`}
                className="pos-tap rounded-lg bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-700"
              >
                {dict.home.ctaSeeMenu}
              </Link>
              <Link
                href={`/${locale}/order`}
                className="pos-tap rounded-lg border border-brand-600 px-5 py-3 font-semibold text-brand-700 hover:bg-brand-100"
              >
                {dict.home.ctaOrder}
              </Link>
              <WhatsAppCta text={`Hello ${BRAND_NAME}, I would like to order.`} />
            </div>

            {branch?.openingDate && new Date(branch.openingDate) > new Date() ? (
              <p className="mt-6 inline-block rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm text-brand-800">
                Opening{' '}
                {new Date(branch.openingDate).toLocaleDateString(locale === 'en' ? 'en-IN' : locale, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            ) : null}
            </div>

            <div className="mx-auto w-full max-w-xs lg:max-w-sm">
              <ThaliIllustration className="w-full drop-shadow-sm" />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-14">
          <h2 className="font-display text-2xl font-semibold text-brand-800">{dict.home.whyTitle}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: dict.home.whyLessOil, b: dict.home.whyLessOilBody },
              { t: dict.home.whyFresh, b: dict.home.whyFreshBody },
              { t: dict.home.whyMithila, b: dict.home.whyMithilaBody },
              { t: dict.home.whyHonest, b: dict.home.whyHonestBody },
            ].map((c) => (
              <div key={c.t} className="rounded-xl border border-ink-200 bg-white p-5">
                <h3 className="font-medium text-ink-900">{c.t}</h3>
                <p className="mt-2 text-sm text-ink-600">{c.b}</p>
              </div>
            ))}
          </div>
        </section>

        {thali.length > 0 ? (
          <section className="mx-auto max-w-5xl px-4 pb-14">
            <div className="flex items-end justify-between">
              <h2 className="font-display text-2xl font-semibold text-brand-800">{dict.home.todayTitle}</h2>
              <Link href={`/${locale}/menu`} className="text-sm font-medium text-brand-700 underline">
                {dict.nav.menu}
              </Link>
            </div>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {thali.map((item) => (
                <li key={item.id} className="rounded-xl border border-ink-200 bg-white p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-medium">{pickI18n(item.name, item.nameI18n, locale)}</h3>
                    <span className="whitespace-nowrap font-medium tabular-nums text-brand-700">
                      {formatMinor(item.variants[0]?.priceMinor ?? 0)}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="mt-1 text-sm text-ink-600">
                      {pickI18n(item.description, item.descriptionI18n, locale)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mx-auto max-w-5xl px-4 pb-16">
          <div className="grid gap-6 rounded-xl border border-ink-200 bg-white p-6 sm:grid-cols-2">
            <div>
              <h2 className="font-display text-xl font-semibold text-brand-800">{dict.home.slotsTitle}</h2>
              <ul className="mt-4 space-y-3">
                {SHOP.hours.map((h) => (
                  <li key={h.label} className="flex items-baseline justify-between gap-4 border-b border-ink-100 pb-2">
                    <span className="text-ink-800">{h.label}</span>
                    <span className="tabular-nums text-ink-600">{h.value}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-brand-800">{dict.home.findUsTitle}</h2>
              <address className="mt-4 not-italic text-ink-600">
                {(branch
                  ? [branch.addressLine1, branch.addressLine2, `${branch.city}, ${branch.state} ${branch.pincode}`]
                  : SHOP.addressLines
                )
                  .filter(Boolean)
                  .map((l) => (
                    <div key={String(l)}>{l}</div>
                  ))}
              </address>
              <a
                className="mt-4 inline-block rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-800 hover:bg-ink-50"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(SHOP.mapsQuery)}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open in Maps
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
