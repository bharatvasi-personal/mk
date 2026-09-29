import Link from 'next/link';
import type { Metadata } from 'next';
import QRCode from 'qrcode';
import { formatMinor, pickI18n } from '@mk/shared';
import {
  AnnouncementBar,
  CorporateQuoteForm,
  Eyebrow,
  FloatingWhatsApp,
  MarketingFooter,
  MarketingHeader,
  MenuFilter,
  MobileActionBar,
  SectionHeading,
  SubscriptionPlans,
  WhatsAppGlyph,
} from '@/components/marketing';
import { type SubscriptionPlan } from '@/components/marketing';
import { SHOP, whatsappLink } from '@/lib/config';
import { serverGet, type PublicBranch, type PublicMenuCategory, type PublicMenuItem } from '@/lib/server-api';
import { resolveLocale, type Locale } from '@/lib/i18n';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  return {
    title: 'Mithila Kitchen Hyderabad — Homely Food Has Arrived',
    description:
      'Freshly prepared homestyle Lunch & Dinner delivered across Hyderabad. Ghar ki Thali from ₹99, ' +
      'Mithila Deluxe Royal, weekly and monthly subscriptions, and corporate meal boxes.',
    alternates: {
      canonical: `/${locale}`,
      languages: { en: '/en', hi: '/hi', te: '/te' },
    },
  };
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);

  const branches = (await serverGet<PublicBranch[]>('/public/branches')) ?? [];
  const branch = branches[0];
  const menu = branch ? ((await serverGet<PublicMenuCategory[]>(`/public/menu/${branch.id}`)) ?? []) : [];

  // Rendered on the server so the page needs no client-side QR library — it is the same
  // image on every request, and shipping a generator to do that would be wasteful.
  const orderLink = whatsappLink("Hello Mithila Kitchen, I'd like to place an order.");
  const qr = await QRCode.toString(orderLink, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#2d2522', light: '#ffffff00' },
  });

  const dishes = menu.flatMap((c) => c.items);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: 'Mithila Kitchen',
    slogan: SHOP.tagline,
    description:
      'Freshly prepared homestyle Lunch & Dinner delivered across Hyderabad. Traditional home cooking, ' +
      'light oil, food-grade packaging.',
    servesCuisine: ['North Indian', 'Mithila', 'Home-style'],
    priceRange: '₹₹',
    telephone: SHOP.phoneDisplay,
    address: {
      '@type': 'PostalAddress',
      streetAddress: branch?.addressLine1 ?? SHOP.addressLines[0],
      addressLocality: branch?.city ?? SHOP.city,
      addressRegion: branch?.state ?? 'Telangana',
      postalCode: branch?.pincode ?? '502300',
      addressCountry: 'IN',
    },
    areaServed: SHOP.areas.map((a) => ({ '@type': 'Place', name: `${a.name}, Hyderabad` })),
    hasMenu: { '@type': 'Menu', url: `/${locale}/menu` },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <AnnouncementBar />
      <MarketingHeader />

      <main>
        <Hero qr={qr} orderLink={orderLink} locale={locale} />
        <HelloBand />
        <Journey locale={locale} />
        <WhatsCooking dishes={dishes} locale={locale} orderLink={orderLink} />
        <Subscriptions />
        <ServiceAreas />
        <Corporate qr={qr} />
        <Promise />
      </main>

      <MarketingFooter />
      <FloatingWhatsApp />
      <MobileActionBar />
    </>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function Hero({ qr, orderLink, locale }: { qr: string; orderLink: string; locale: Locale }) {
  return (
    <section className="border-b border-ink-200 bg-gradient-to-b from-brand-50 via-ink-50 to-ink-50">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[1.25fr_1fr] lg:py-14">
        <div>
          <p className="font-display text-sm italic text-brand-600">{SHOP.tagline}</p>

          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-leaf-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.15em] text-leaf-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-leaf-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-leaf-500" />
            </span>
            Now serving {SHOP.city}
          </p>

          <h1 className="mt-4 max-w-2xl font-display text-4xl font-extrabold leading-[1.08] text-ink-900 sm:text-5xl lg:text-6xl">
            Homely Food Has Arrived in {SHOP.city}.
          </h1>

          <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-600">
            Freshly prepared <strong className="font-bold text-ink-900">Lunch &amp; Dinner</strong>, inspired by
            traditional home cooking and made with carefully selected ingredients.
          </p>

          <div className="mt-7 space-y-4">
            <div className="rounded-xl border border-ink-200 bg-white p-4">
              <h3 className="font-display text-lg font-bold text-brand-600">Why Mithila Kitchen?</h3>
              <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {SHOP.why.map((w) => (
                  <li key={w} className="flex items-start gap-2 text-sm text-ink-600">
                    <Tick />
                    {w}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border-2 border-brand-200 bg-brand-50 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-base font-bold text-brand-700">🍱 Lunch &amp; Dinner Menu</h3>
                <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-brand-500">
                  Simple • Fresh • Homely
                </span>
              </div>
              <ol className="mt-3 space-y-2.5 text-sm">
                <li>
                  <span className="font-bold text-ink-900">1. Ghar ki Thali</span>{' '}
                  <span className="text-ink-600">(Veg / Non-Veg)</span>
                  <div className="text-xs text-brand-700">
                    Launch offer: Veg <strong>₹99</strong> <s className="opacity-50">₹149</s> · Non-Veg{' '}
                    <strong>₹149</strong> <s className="opacity-50">₹199</s>
                  </div>
                </li>
                <li>
                  <span className="font-bold text-ink-900">2. Mithila Deluxe Royal</span>{' '}
                  <span className="text-ink-600">(Veg / Non-Veg)</span>
                  <div className="text-xs text-ink-600">
                    Royal feast with Paneer / Special Chicken Curry + Basmati Rice + Dessert
                  </div>
                </li>
              </ol>
              <p className="mt-3 border-t border-brand-200 pt-2 text-xs text-ink-600">
                🍗 Non-Veg = Chicken Curry · Options: Roti Thali • Paratha Thali
              </p>
              <p className="mt-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-500">
                Working Professionals • Families • Students
              </p>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={orderLink}
              target="_blank"
              rel="noreferrer noopener"
              className="pos-tap inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-3 font-bold text-white transition-colors hover:bg-brand-700"
            >
              Order Now
            </a>
            <a
              href="#menu"
              className="pos-tap rounded-lg border-2 border-ink-200 bg-white px-6 py-3 font-bold text-ink-800 transition-colors hover:border-brand-300"
            >
              Explore Today&rsquo;s Menu
            </a>
          </div>

          <figure className="mt-8 border-l-4 border-brand-300 pl-4">
            <blockquote className="font-display text-lg italic text-ink-800">
              “Your everyday meal, made with the care of home.”
            </blockquote>
            <figcaption className="mt-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
              Mithila Kitchen — {SHOP.tagline}
            </figcaption>
          </figure>
        </div>

        {/* The ordering card. WhatsApp is the channel, so it gets the whole column. */}
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
            <div className="bg-wa-700 px-4 py-2.5 text-center text-[11px] font-extrabold uppercase tracking-[0.18em] text-white">
              <span className="inline-flex items-center gap-2">
                <WhatsAppGlyph className="h-4 w-4" />
                Order now on WhatsApp
              </span>
            </div>

            <div className="p-5 text-center">
              <h3 className="font-display text-xl font-bold text-ink-900">Scan the QR Code to Order</h3>
              <p className="mt-1 text-sm text-ink-600">
                Opens directly in WhatsApp with today&rsquo;s dispatch coordinator.
              </p>

              <div
                className="mx-auto mt-4 w-44 rounded-xl border-2 border-ink-100 bg-white p-3 [&_svg]:h-full [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qr }}
                aria-label="QR code that opens a WhatsApp chat to order"
                role="img"
              />

              <p className="mt-3 text-[10px] font-extrabold uppercase tracking-[0.2em] text-brand-600">
                Scan to chat &amp; order
              </p>
              <p className="mt-1 text-sm font-bold text-ink-900">📱 {SHOP.phoneDisplay}</p>

              <div className="mt-5 rounded-xl bg-ink-50 p-3">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-ink-400">
                  Direct WhatsApp line
                </p>
                <p className="mt-1 font-display text-xl font-bold text-ink-900">{SHOP.phoneDisplay}</p>
                <a
                  href={orderLink}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="pos-tap mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-wa-500 px-4 py-2.5 font-bold text-white transition-colors hover:bg-wa-600"
                >
                  <WhatsAppGlyph className="h-4 w-4" />
                  Tap to Chat
                </a>
              </div>

              <Link
                href={`/${locale}/order`}
                className="mt-3 inline-block text-xs font-semibold text-brand-700 underline"
              >
                Prefer to order on the website?
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {SHOP.service.map((s) => (
              <div key={s.key} className="rounded-xl border border-ink-200 bg-white p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="font-display font-bold text-ink-900">
                    {s.icon} {s.label}
                  </h4>
                  <span className="text-xs font-semibold tabular-nums text-brand-600">{s.window}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-600">{s.contents}</p>
                <p className="mt-2 rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-700">
                  ⏰ {s.cutoff} · {s.delivery}
                </p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-leaf-500" fill="currentColor" aria-hidden>
      <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0z" />
    </svg>
  );
}

// ─── Bands and sections ──────────────────────────────────────────────────────

function HelloBand() {
  return (
    <section className="bg-ink-900 px-4 py-12 text-center">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.25em] text-brand-300">
        Hello {SHOP.city} 👋
      </p>
      <h2 className="mx-auto mt-3 max-w-3xl font-display text-3xl font-extrabold text-white sm:text-4xl">
        Your new home for homely food.
      </h2>
      <p className="mt-4 text-sm font-semibold uppercase tracking-[0.15em] text-brand-200">
        Order your first meal
      </p>
      <p className="mt-1 text-lg text-white">
        Veg Thali <strong>₹99</strong> · Non-Veg Chicken <strong>₹149</strong>
      </p>
      <a
        href={whatsappLink("Hello Mithila Kitchen, I'd like to order my first meal.")}
        target="_blank"
        rel="noreferrer noopener"
        className="pos-tap mt-6 inline-flex items-center gap-2 rounded-lg bg-wa-500 px-6 py-3 font-bold text-white transition-colors hover:bg-wa-600"
      >
        <WhatsAppGlyph className="h-5 w-5" />
        Order Now
      </a>
    </section>
  );
}

function Journey({ locale }: { locale: Locale }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-14">
      <SectionHeading
        eyebrow="Simple 3-step journey"
        title="Your First Meal From Mithila Kitchen"
        body="New to Mithila Kitchen? We're happy to have you."
      />
      <ol className="mt-10 grid gap-5 sm:grid-cols-3">
        {SHOP.steps.map((s) => (
          <li key={s.n} className="relative rounded-xl border border-ink-200 bg-white p-5">
            <span className="font-display text-4xl font-extrabold text-brand-100">{s.n}</span>
            <h3 className="mt-1 font-display text-lg font-bold text-ink-900">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">{s.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-center text-sm text-ink-600">
        Questions about today&rsquo;s sabzi or custom meal timings in {SHOP.city}?{' '}
        <Link href={`/${locale}/menu`} className="font-semibold text-brand-700 underline">
          Start browsing the menu
        </Link>
      </p>
    </section>
  );
}

/**
 * The menu.
 *
 * Driven by the live branch menu rather than hard-coded, so a price changed in the back
 * office reaches this page — which is the entire point of the Publish button next to it.
 *
 * Descriptions use ` • ` as a separator, and the part after the first full stop becomes
 * the "thali contents" list. That convention lets one text field serve both the prose the
 * public menu wants and the itemised list this card wants.
 */
function WhatsCooking({
  dishes,
  locale,
  orderLink,
}: {
  dishes: PublicMenuItem[];
  locale: Locale;
  orderLink: string;
}) {
  return (
    <section id="menu" className="border-y border-ink-200 bg-white px-4 py-14">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Daily homestyle meals"
          title="What's Cooking?"
          body={`Freshly prepared Lunch & Dinner in ${SHOP.city}. Simple, fresh, homestyle cooking made with love.`}
        />

        <div className="mx-auto mt-8 max-w-3xl rounded-2xl bg-brand-600 p-6 text-center text-white">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-brand-200">
            Special {SHOP.city} launch offer
          </p>
          <h3 className="mt-2 font-display text-2xl font-extrabold">Ghar ki Thali &amp; Mithila Deluxe Royal</h3>
          <p className="mt-2 text-sm text-brand-100">
            Authentic North-Indian &amp; Mithila home cooking with pure ingredients, light oil, and signature
            spices.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Veg Thali', now: '₹99', was: '₹149', note: 'Save ₹50 • Launch offer' },
              { label: 'Non-Veg Thali', now: '₹149', was: '₹199', note: 'Chicken curry • Save ₹50' },
            ].map((o) => (
              <div key={o.label} className="rounded-xl bg-white/10 p-4">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-brand-200">
                  {o.label}
                </div>
                <div className="mt-1 flex items-baseline justify-center gap-2">
                  <span className="font-display text-3xl font-extrabold">{o.now}</span>
                  <s className="text-lg opacity-60">{o.was}</s>
                </div>
                <div className="mt-1 text-[11px] font-semibold text-brand-100">{o.note}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-brand-100">
            Bread choice: Roti Thali (4 soft rotis) or Paratha Thali (3 golden layered parathas)
          </p>
        </div>

        {dishes.length === 0 ? (
          <p className="mt-10 text-center text-ink-400">
            Today&rsquo;s menu is being prepared. Message us on WhatsApp for what is cooking right now.
          </p>
        ) : (
          <MenuFilter
            dishes={dishes.map((item) => ({
              key: item.id,
              isVeg: item.foodType === 'VEG' || item.foodType === 'JAIN',
              bread: breadOf(pickI18n(item.name, item.nameI18n, locale)),
              node: <DishCard item={item} locale={locale} orderLink={orderLink} />,
            }))}
          />
        )}

        <div className="mx-auto mt-10 max-w-2xl rounded-xl border border-ink-200 bg-ink-50 p-5 text-center">
          <p className="font-display text-lg font-bold text-ink-900">
            Prefer ordering your thali directly over WhatsApp chat?
          </p>
          <p className="mt-1 text-sm text-ink-600">
            Our kitchen coordinator confirms the delivery slot, spice preference, and sends a live UPI QR.
          </p>
          <a
            href={orderLink}
            target="_blank"
            rel="noreferrer noopener"
            className="pos-tap mt-4 inline-flex items-center gap-2 rounded-lg bg-wa-500 px-5 py-2.5 font-bold text-white hover:bg-wa-600"
          >
            <WhatsAppGlyph className="h-4 w-4" />
            Order Now
          </a>
        </div>

        <p className="mt-6 text-center text-xs text-ink-400">
          *Special launch pricing valid for a limited period in {SHOP.city}. Contact us on WhatsApp for custom
          spice levels.
        </p>
      </div>
    </section>
  );
}

function breadOf(name: string): 'ROTI' | 'PARATHA' | null {
  const n = name.toLowerCase();
  if (n.includes('paratha')) return 'PARATHA';
  if (n.includes('roti')) return 'ROTI';
  return null;
}

function DishCard({ item, locale, orderLink }: { item: PublicMenuItem; locale: Locale; orderLink: string }) {
  const name = pickI18n(item.name, item.nameI18n, locale);
  const description = pickI18n(item.description ?? '', item.descriptionI18n, locale);

  // Prose first, then the itemised contents — see the note on WhatsCooking.
  const [prose, ...rest] = description.split(/(?<=\.)\s+/);
  const contents = rest.join(' ').split(' • ').map((c) => c.trim()).filter(Boolean);

  const variant = item.variants[0];
  const isVeg = item.foodType === 'VEG' || item.foodType === 'JAIN';
  const bread = breadOf(name);

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 bg-ink-50 px-4 py-2">
        <span
          className={`text-[10px] font-extrabold uppercase tracking-[0.15em] ${
            isVeg ? 'text-leaf-600' : 'text-brand-600'
          }`}
        >
          {isVeg ? '🌿 Pure veg' : '🍗 Non-veg chicken'}
        </span>
        <span className="flex items-center gap-2">
          {bread ? (
            <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ink-400">
              {bread === 'ROTI' ? 'Roti thali' : 'Paratha thali'}
            </span>
          ) : null}
          {variant && variant.compareAtPriceMinor ? (
            <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
              Save {formatMinor(variant.compareAtPriceMinor - variant.priceMinor)}
            </span>
          ) : null}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-display text-lg font-bold leading-snug text-ink-900">{name}</h3>

        {isVeg ? null : (
          <p className="mt-1 text-xs font-semibold text-brand-600">🍗 Includes homestyle chicken curry</p>
        )}

        {variant ? (
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-2xl font-extrabold text-ink-900">
              {formatMinor(variant.priceMinor)}
            </span>
            {variant.compareAtPriceMinor ? (
              <s className="text-ink-400">{formatMinor(variant.compareAtPriceMinor)}</s>
            ) : null}
          </div>
        ) : null}

        {prose ? <p className="mt-2 text-sm leading-relaxed text-ink-600">{prose}</p> : null}

        {contents.length > 0 ? (
          <>
            <p className="mt-3 text-[10px] font-extrabold uppercase tracking-[0.15em] text-ink-400">
              Thali contents
            </p>
            <ul className="mt-1.5 space-y-1">
              {contents.map((c) => (
                <li key={c} className="flex items-start gap-2 text-sm text-ink-600">
                  <Tick />
                  {c}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="mt-4 flex gap-2 pt-1">
          <Link
            href={`/${locale}/order`}
            className="pos-tap flex-1 rounded-lg bg-brand-600 px-3 py-2.5 text-center text-sm font-bold text-white hover:bg-brand-700"
          >
            Add to Order{variant ? ` • ${formatMinor(variant.priceMinor)}` : ''}
          </Link>
          <a
            href={orderLink}
            target="_blank"
            rel="noreferrer noopener"
            className="pos-tap grid w-11 place-items-center rounded-lg bg-wa-500 text-white hover:bg-wa-600"
            aria-label={`Order ${name} on WhatsApp`}
          >
            <WhatsAppGlyph className="h-5 w-5" />
          </a>
        </div>
      </div>
    </article>
  );
}

function Subscriptions() {
  const plans: SubscriptionPlan[] = [
    {
      badge: 'Weekly plan',
      title: 'Weekly Meal Subscription',
      body: 'Try us out for 6 or 7 days with complete flexibility. Rotate between comforting rotis and crispy parathas.',
      points: [
        'Flexible meal plans',
        'Home-style variety every day',
        'Veg & Non-Veg (Chicken Curry) options',
        'Suitable for individuals and families',
      ],
      cta: 'Enquire Weekly Plan on WhatsApp',
      note: 'Pause or reschedule anytime with 6 hours notice',
      popular: false,
    },
    {
      badge: 'Monthly plan',
      title: 'Monthly Meal Subscription',
      body: 'Guaranteed daily homestyle food delivered consistently. Zero prep, zero cooking, and priority dispatch.',
      points: [
        'Convenient & hassle-free monthly billing',
        'Consistent hygienic quality',
        'Veg & Non-Veg (Chicken Curry) options',
        'Ideal for working professionals, families and students',
      ],
      cta: 'Get Monthly Subscription Plan',
      note: 'Includes weekend carryovers & delivery tracking',
      popular: true,
    },
  ];

  return (
    <section id="subscriptions" className="mx-auto max-w-6xl px-4 py-14">
      <SectionHeading
        eyebrow="Daily homely meals made easy"
        title="Weekly & Monthly Subscription Also Available"
        body="Say goodbye to daily cooking stress and expensive oily restaurant food. Enjoy freshly prepared, light and comforting homestyle meals delivered right to your doorstep."
      />

      <SubscriptionPlans plans={plans} />

      <p className="mt-6 text-center text-sm text-ink-600">
        {SHOP.city} coverage: Gachibowli, Kondapur, Hitech City, Madhapur, Financial District, Nanakramguda,
        Kokapet &amp; more.
      </p>
      <p className="mt-1 text-center text-sm text-ink-600">
        Save time • Enjoy homely meals every day ·{' '}
        <a className="font-semibold text-brand-700 underline" href={whatsappLink('Hello!')}>
          WhatsApp helpline {SHOP.phoneDisplay}
        </a>
      </p>
    </section>
  );
}

function ServiceAreas() {
  return (
    <section id="areas" className="border-y border-ink-200 bg-white px-4 py-14">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow={`${SHOP.city} coverage`}
          title={`Serving ${SHOP.city}`}
          body={`Starting our journey in ${SHOP.city}, Mithila Kitchen is bringing homely lunch and dinner to individuals, families and working teams.`}
        />

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SHOP.areas.map((a) => (
            <div key={a.name} className="rounded-xl border border-ink-200 bg-ink-50 p-4">
              <h3 className="font-display font-bold text-ink-900">{a.name}</h3>
              <p className="text-xs text-ink-400">{a.note}</p>
              <p className="mt-2 text-sm font-semibold tabular-nums text-brand-600">Est. {a.eta}</p>
              <a
                href={whatsappLink(`Hello, do you deliver to ${a.name}?`)}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 inline-block text-xs font-semibold text-wa-700 underline"
              >
                Confirm on WhatsApp
              </a>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-8 max-w-2xl rounded-xl bg-brand-50 p-5 text-center">
          <p className="font-display text-lg font-bold text-ink-900">
            Don&rsquo;t see your society or tech park?
          </p>
          <p className="mt-1 text-sm text-ink-600">
            We frequently arrange daily lunches and group subscriptions for societies and office towers nearby.
          </p>
          <a
            href={whatsappLink('Hello, do you deliver to my area?')}
            target="_blank"
            rel="noreferrer noopener"
            className="pos-tap mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 font-bold text-white hover:bg-brand-700"
          >
            Check Availability on WhatsApp
          </a>
        </div>

        <p className="mt-4 text-center text-xs text-ink-400">
          *Delivery zones expand as kitchen logistics grow across the city.
        </p>
      </div>
    </section>
  );
}

function Corporate({ qr }: { qr: string }) {
  return (
    <section id="corporate" className="mx-auto max-w-6xl px-4 py-14">
      <SectionHeading
        eyebrow="Corporate meals"
        title="Good Food For Good Teams."
        body="Looking for reliable lunch or dinner solutions for your office?"
      />

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-ink-200 bg-white p-6">
          <Eyebrow>{SHOP.city} office catering</Eyebrow>
          <h3 className="mt-2 font-display text-xl font-bold text-ink-900">
            We accept corporate &amp; bulk meal orders for:
          </h3>
          <p className="mt-2 text-sm text-ink-600">
            Nutritious homestyle meals cooked fresh twice a day. Zero food coma, light oil and pure cow ghee.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {SHOP.corporate.map((c) => (
              <li key={c} className="flex items-start gap-2 text-sm text-ink-600">
                <Tick />
                {c}
              </li>
            ))}
          </ul>
          <p className="mt-5 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
            Serving Madhapur, Hitech City, Financial District, Kokapet, Gachibowli &amp; nearby areas.
          </p>
        </div>

        <div className="rounded-2xl border-2 border-brand-200 bg-brand-50 p-6 text-center">
          <Eyebrow>Get corporate pricing</Eyebrow>
          <h3 className="mt-2 font-display text-lg font-bold text-ink-900">
            Scan the QR Code or WhatsApp Us
          </h3>
          <p className="mt-2 text-sm text-ink-600">
            Tell us your team size and office location. We&rsquo;ll share customised menu plans and corporate
            pricing instantly.
          </p>
          <div
            className="mx-auto mt-4 w-36 rounded-xl border-2 border-white bg-white p-3 [&_svg]:h-full [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qr }}
            aria-hidden
          />
          <p className="mt-3 text-[10px] font-extrabold uppercase tracking-[0.2em] text-ink-400">
            WhatsApp helpline
          </p>
          <p className="font-display text-lg font-bold text-ink-900">{SHOP.phoneDisplay}</p>
          <a
            href={whatsappLink(
              'Hello Mithila Kitchen, we need corporate meals. Team size: __, Office location: __',
            )}
            target="_blank"
            rel="noreferrer noopener"
            className="pos-tap mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-wa-500 px-4 py-3 font-bold text-white hover:bg-wa-600"
          >
            <WhatsAppGlyph className="h-4 w-4" />
            WhatsApp for Corporate Pricing
          </a>
        </div>
      </div>

      <div className="mt-6">
        <CorporateQuoteForm />
      </div>
    </section>
  );
}

function Promise() {
  return (
    <section id="promise" className="border-t border-ink-200 bg-white px-4 py-14">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Authentic home culinary promise"
          title="Food That Feels Like Home"
          body="At Mithila Kitchen, we believe everyday food should be comforting, thoughtfully prepared and full of familiar flavours. From ingredient selection to preparation and packaging, we pay attention to the details that matter."
        />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SHOP.promise.map((p) => (
            <div key={p.title} className="rounded-xl border border-ink-200 bg-ink-50 p-5 text-center">
              <div className="text-3xl">{p.icon}</div>
              <h3 className="mt-2 font-display text-sm font-extrabold uppercase tracking-wide text-ink-900">
                {p.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{p.body}</p>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-brand-600">
                Standard at Mithila Kitchen
              </p>
            </div>
          ))}
        </div>

        <figure className="mx-auto mt-10 max-w-2xl text-center">
          <blockquote className="font-display text-xl italic text-ink-800">
            “Your everyday meal, made with the care of home.”
          </blockquote>
          <figcaption className="mt-2 text-xs font-semibold uppercase tracking-[0.15em] text-ink-400">
            Mithila Kitchen • {SHOP.tagline}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
