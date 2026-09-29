import type { Metadata } from 'next';
import {
  AnnouncementBar,
  Eyebrow,
  FloatingWhatsApp,
  MarketingFooter,
  MarketingHeader,
  MobileActionBar,
  SectionHeading,
  WhatsAppGlyph,
} from '@/components/marketing';
import { SHOP, whatsappLink } from '@/lib/config';
import { serverGet, type PublicBranch } from '@/lib/server-api';
import { resolveLocale } from '@/lib/i18n';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  return {
    title: `Delivery areas & contact — Mithila Kitchen ${SHOP.city}`,
    description: `Where Mithila Kitchen delivers across ${SHOP.city}, our lunch and dinner windows, and how to reach us.`,
    alternates: { canonical: `/${locale}/visit` },
  };
}

/**
 * Contact and coverage.
 *
 * Framed around delivery rather than a shopfront, because that is how the orders arrive:
 * the question a visitor has is "do you come to my area and by when", not "where are you".
 */
export default async function VisitPage({ params }: { params: Promise<{ locale: string }> }) {
  resolveLocale((await params).locale);
  const branches = (await serverGet<PublicBranch[]>('/public/branches')) ?? [];
  const kitchen = branches[0];

  return (
    <>
      <AnnouncementBar />
      <MarketingHeader />

      <main className="mx-auto max-w-5xl px-4 py-12">
        <SectionHeading
          eyebrow={`${SHOP.city} coverage`}
          title="Where we deliver, and when"
          body={`Freshly prepared lunch and dinner across ${SHOP.city}. Delivery times are indicative and confirmed on WhatsApp for each order.`}
        />

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {SHOP.service.map((s) => (
            <div key={s.key} className="rounded-2xl border border-ink-200 bg-white p-6">
              <h2 className="font-display text-xl font-bold text-ink-900">
                {s.icon} {s.label}
              </h2>
              <p className="mt-1 text-sm font-semibold tabular-nums text-brand-600">{s.window}</p>
              <p className="mt-3 text-sm leading-relaxed text-ink-600">{s.contents}</p>
              <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700">
                ⏰ {s.cutoff}
                <span className="block font-normal text-ink-600">{s.delivery}</span>
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <Eyebrow>Delivery areas</Eyebrow>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SHOP.areas.map((a) => (
              <div key={a.name} className="flex items-baseline justify-between gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3">
                <span>
                  <span className="block font-semibold text-ink-900">{a.name}</span>
                  <span className="block text-xs text-ink-400">{a.note}</span>
                </span>
                <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-brand-600">
                  {a.eta}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <div className="rounded-2xl border border-ink-200 bg-white p-6">
            <Eyebrow>Talk to us</Eyebrow>
            <p className="mt-2 font-display text-2xl font-bold text-ink-900">{SHOP.phoneDisplay}</p>
            <p className="mt-1 text-sm text-ink-600">
              Menu, availability, delivery areas, spice levels and subscriptions — all on WhatsApp.
            </p>
            <a
              href={whatsappLink('Hello Mithila Kitchen!')}
              target="_blank"
              rel="noreferrer noopener"
              className="pos-tap mt-4 inline-flex items-center gap-2 rounded-lg bg-wa-500 px-5 py-2.5 font-bold text-white hover:bg-wa-600"
            >
              <WhatsAppGlyph className="h-4 w-4" />
              Message us
            </a>
          </div>

          <div className="rounded-2xl border border-ink-200 bg-white p-6">
            <Eyebrow>Our kitchen</Eyebrow>
            <address className="mt-2 not-italic text-ink-600">
              {(kitchen
                ? [kitchen.addressLine1, kitchen.addressLine2, `${kitchen.city}, ${kitchen.state} ${kitchen.pincode}`]
                : SHOP.addressLines
              )
                .filter(Boolean)
                .map((line) => (
                  <div key={String(line)}>{line}</div>
                ))}
            </address>
            <p className="mt-3 text-sm text-ink-600">
              Meals are cooked here twice a day and dispatched. Collection can be arranged — ask on WhatsApp.
            </p>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(SHOP.mapsQuery)}`}
              target="_blank"
              rel="noreferrer noopener"
              className="pos-tap mt-4 inline-block rounded-lg border-2 border-ink-200 px-5 py-2.5 font-semibold text-ink-800 hover:border-brand-300"
            >
              Open in Maps
            </a>
          </div>
        </div>
      </main>

      <MarketingFooter />
      <FloatingWhatsApp />
      <MobileActionBar />
    </>
  );
}
