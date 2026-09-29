import type { Metadata } from 'next';
import { getDictionary } from '@mk/shared';
import { SiteFooter, SiteHeader, WhatsAppCta } from '@/components/site-chrome';
import { BRAND_NAME, SHOP } from '@/lib/config';
import { serverGet, type PublicBranch } from '@/lib/server-api';
import { resolveLocale } from '@/lib/i18n';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return { title: dict.nav.contact, description: `${BRAND_NAME} — ${SHOP.addressLines.join(', ')}` };
}

export default async function VisitPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const dict = getDictionary(locale);
  const branches = (await serverGet<PublicBranch[]>('/public/branches')) ?? [];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-display text-3xl font-bold text-brand-900">{dict.nav.contact}</h1>
        <p className="mt-2 text-ink-600">{dict.brand.subTagline}</p>

        {(branches.length ? branches : [null]).map((branch, index) => (
          <section key={branch?.id ?? index} className="mt-8 rounded-xl border border-ink-200 bg-white p-6">
            <h2 className="font-display text-xl font-semibold text-brand-800">{branch?.name ?? 'Osman Nagar'}</h2>
            <address className="mt-3 not-italic text-ink-600">
              {(branch
                ? [branch.addressLine1, branch.addressLine2, `${branch.city}, ${branch.state} ${branch.pincode}`]
                : SHOP.addressLines
              )
                .filter(Boolean)
                .map((l) => (
                  <div key={String(l)}>{l}</div>
                ))}
            </address>

            <dl className="mt-5 space-y-2">
              {SHOP.hours.map((h) => (
                <div key={h.label} className="flex items-baseline justify-between gap-4 border-b border-ink-100 pb-2">
                  <dt className="text-ink-800">{h.label}</dt>
                  <dd className="tabular-nums text-ink-600">{h.value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={`tel:${(branch?.phone ?? SHOP.phone).replace(/\s/g, '')}`}
                className="pos-tap rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
              >
                {branch?.phone ?? SHOP.phone}
              </a>
              <WhatsAppCta text={`Hello ${BRAND_NAME}, I have a question.`} />
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(SHOP.mapsQuery)}`}
                target="_blank"
                rel="noreferrer noopener"
                className="pos-tap rounded-lg border border-ink-200 px-4 py-2 font-medium text-ink-800 hover:bg-ink-50"
              >
                Directions
              </a>
            </div>
          </section>
        ))}
      </main>
      <SiteFooter />
    </>
  );
}
