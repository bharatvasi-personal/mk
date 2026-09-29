'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { LOCALE_LABELS } from '@mk/shared';
import { LOCALES, switchLocalePath } from '@/lib/i18n';
import { useLocale } from '@/lib/dict';
import { SHOP, whatsappLink } from '@/lib/config';

/**
 * The marketing chrome.
 *
 * Kept apart from the staff shell on purpose: the two have opposite jobs. This one is
 * read once by a stranger deciding whether to order, so it leads with the brand and the
 * one action that matters. The staff shell is read two hundred times a day by someone who
 * already knows where everything is.
 */

const NAV = [
  { href: '#menu', label: "Today's Menu" },
  { href: '#subscriptions', label: 'Subscriptions' },
  { href: '#promise', label: 'Our Promise' },
  { href: '#areas', label: 'Service Areas' },
  { href: '#corporate', label: 'Corporate' },
];

/**
 * The cutoff bar.
 *
 * First thing on the page because it is the single most common reason an order fails:
 * someone orders lunch at 11:30 and it cannot be made. Saying it before anything else is
 * cheaper than apologising afterwards.
 */
export function AnnouncementBar() {
  return (
    <div className="bg-brand-700 px-4 py-1.5 text-center text-[11px] font-semibold tracking-wide text-brand-100 sm:text-xs">
      {SHOP.service.map((s, i) => (
        <span key={s.key}>
          {i > 0 ? <span className="mx-2 opacity-50">•</span> : null}
          Pre-order {s.label.replace('Homestyle ', '')} by{' '}
          <strong className="text-white">{s.cutoff.replace(/^Pre-order \w+ by /, '')}</strong>{' '}
          <span className="opacity-80">({s.delivery.replace('Delivered ', 'Delivered ')})</span>
        </span>
      ))}
    </div>
  );
}

export function MarketingHeader() {
  const locale = useLocale();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 border-b bg-white/95 backdrop-blur transition-shadow ${
        scrolled ? 'border-ink-200 shadow-sm' : 'border-transparent'
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
        <Link href={`/${locale}`} className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 font-display text-lg font-bold text-white">
            म
          </span>
          <span className="leading-tight">
            <span className="block font-display text-base font-bold text-ink-900 sm:text-lg">
              Mithila Kitchen
            </span>
            <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-brand-600">
              {SHOP.city}
            </span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <LocaleSwitcher pathname={pathname} locale={locale} />
          <a
            href={whatsappLink("Hello Mithila Kitchen, I'd like to place an order.")}
            target="_blank"
            rel="noreferrer noopener"
            className="pos-tap rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-700 sm:px-4"
          >
            Order Now
          </a>
        </div>
      </div>

      {/* The nav becomes a scrollable strip rather than a hamburger: five links fit, and a
          menu that has to be opened is a menu most people never open. */}
      <nav className="flex gap-1 overflow-x-auto border-t border-ink-100 px-4 py-1.5 lg:hidden">
        {NAV.map((n) => (
          <a
            key={n.href}
            href={n.href}
            className="whitespace-nowrap rounded-lg px-3 py-1 text-xs font-semibold text-ink-600"
          >
            {n.label}
          </a>
        ))}
      </nav>
    </header>
  );
}

function LocaleSwitcher({ pathname, locale }: { pathname: string; locale: string }) {
  return (
    <div className="hidden items-center rounded-lg border border-ink-200 p-0.5 sm:flex">
      {LOCALES.map((l) => (
        <Link
          key={l}
          href={switchLocalePath(pathname, l)}
          lang={l}
          aria-current={l === locale ? 'true' : undefined}
          className={`rounded px-2 py-1 text-[11px] font-bold ${
            l === locale ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100'
          }`}
        >
          {l === 'en' ? 'EN' : LOCALE_LABELS[l]}
        </Link>
      ))}
    </div>
  );
}

/** The section label used above every heading on the live site. */
export function Eyebrow({ children, tone = 'brand' }: { children: ReactNode; tone?: 'brand' | 'light' }) {
  return (
    <p
      className={`text-[11px] font-extrabold uppercase tracking-[0.2em] ${
        tone === 'light' ? 'text-brand-200' : 'text-brand-600'
      }`}
    >
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  body,
  light,
  centred = true,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  light?: boolean;
  centred?: boolean;
}) {
  return (
    <div className={`${centred ? 'mx-auto max-w-2xl text-center' : ''}`}>
      {eyebrow ? <Eyebrow tone={light ? 'light' : 'brand'}>{eyebrow}</Eyebrow> : null}
      <h2
        className={`mt-2 font-display text-3xl font-extrabold leading-tight sm:text-4xl ${
          light ? 'text-white' : 'text-ink-900'
        }`}
      >
        {title}
      </h2>
      {body ? (
        <p className={`mt-3 text-base ${light ? 'text-brand-100' : 'text-ink-600'}`}>{body}</p>
      ) : null}
    </div>
  );
}

/**
 * The WhatsApp button that follows you down the page.
 *
 * WhatsApp is not one channel among several here — it is how the orders actually arrive.
 * It sits above the mobile bar so it never covers the total.
 */
export function FloatingWhatsApp() {
  return (
    <a
      href={whatsappLink("Hello Mithila Kitchen, I'd like to order today's thali.")}
      target="_blank"
      rel="noreferrer noopener"
      className="pos-tap fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-wa-500 px-4 py-3 text-sm font-bold text-white shadow-lg transition-transform hover:scale-105 sm:bottom-6"
      aria-label="Order on WhatsApp"
    >
      <WhatsAppGlyph className="h-5 w-5" />
      <span className="hidden sm:inline">Order Now</span>
    </a>
  );
}

export function WhatsAppGlyph({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.48-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z" />
      <path d="M12.04 2C6.6 2 2.18 6.42 2.18 11.86c0 1.74.46 3.44 1.32 4.93L2.05 22l5.34-1.4a9.82 9.82 0 0 0 4.65 1.18h.01c5.43 0 9.85-4.42 9.85-9.86A9.79 9.79 0 0 0 19 4.9 9.78 9.78 0 0 0 12.04 2zm0 17.96h-.01a8.2 8.2 0 0 1-4.17-1.14l-.3-.18-3.1.81.83-3.02-.2-.31a8.13 8.13 0 0 1-1.25-4.35c0-4.52 3.68-8.2 8.2-8.2a8.14 8.14 0 0 1 8.19 8.2c0 4.52-3.68 8.19-8.19 8.19z" />
    </svg>
  );
}

/**
 * The persistent bar on a phone.
 *
 * Mirrors the live site: the two things a visitor on a handset wants are the menu and a
 * way to order, and neither should require scrolling back to the top to find.
 */
export function MobileActionBar() {
  const locale = useLocale();
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-ink-200 bg-white sm:hidden">
      <a href="#menu" className="pos-tap flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-ink-600">
        <span className="text-base">🍽️</span>
        Menu
      </a>
      <Link
        href={`/${locale}/order`}
        className="pos-tap flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-ink-600"
      >
        <span className="text-base">🧺</span>
        Order online
      </Link>
      <a
        href={whatsappLink("Hello Mithila Kitchen, I'd like to place an order.")}
        target="_blank"
        rel="noreferrer noopener"
        className="pos-tap flex flex-col items-center gap-0.5 bg-wa-500 py-2 text-[11px] font-bold text-white"
      >
        <WhatsAppGlyph className="h-4 w-4" />
        WhatsApp
      </a>
    </div>
  );
}

export function MarketingFooter() {
  const locale = useLocale();
  return (
    <footer className="mt-16 bg-ink-900 pb-24 pt-14 text-brand-100 sm:pb-14">
      <div className="mx-auto max-w-6xl px-4">
        <div className="grid gap-10 sm:grid-cols-3">
          <div>
            <div className="font-display text-2xl font-bold text-white">MITHILA KITCHEN</div>
            <p className="mt-2 text-sm italic text-brand-200">{SHOP.tagline}</p>
            <p className="mt-4 text-sm text-brand-100/80">
              Freshly prepared homestyle Lunch &amp; Dinner, delivered across {SHOP.city}.
            </p>
          </div>

          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-brand-300">
              Reach us
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a
                  className="inline-flex items-center gap-2 font-semibold text-white hover:underline"
                  href={whatsappLink('Hello Mithila Kitchen!')}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <WhatsAppGlyph className="h-4 w-4 text-wa-500" />
                  {SHOP.phoneDisplay}
                </a>
              </li>
              <li className="text-brand-100/80">Serving {SHOP.city}</li>
              <li>
                <a
                  className="text-brand-100/80 hover:underline"
                  href={`https://instagram.com/${SHOP.instagram}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Instagram: @{SHOP.instagram}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-brand-300">
              Scan • Order • Enjoy
            </div>
            <p className="mt-3 text-sm text-brand-100/80">
              Contact us for menu, availability and delivery areas.
            </p>
            <Link
              href={`/${locale}/login`}
              className="mt-6 inline-block text-xs text-brand-100/40 hover:text-brand-100/70"
            >
              Staff login
            </Link>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 text-center text-xs text-brand-100/50">
          © {new Date().getFullYear()} Mithila Kitchen · {SHOP.tagline}
        </div>
      </div>
    </footer>
  );
}

/**
 * Menu filter chips.
 *
 * The reference site puts these above the dish grid, and they earn their place: six cards
 * is already more than someone scanning on a phone wants to read, and "I only eat veg" or
 * "I want parathas" is the first thing most people narrow by. The cards themselves are
 * rendered on the server — this component only chooses which of them to show, so filtering
 * ships no dish data to the browser twice.
 */
export type DishFilter = 'ALL' | 'VEG' | 'NONVEG' | 'ROTI' | 'PARATHA';

export function MenuFilter({
  dishes,
}: {
  dishes: { key: string; isVeg: boolean; bread: 'ROTI' | 'PARATHA' | null; node: ReactNode }[];
}) {
  const [filter, setFilter] = useState<DishFilter>('ALL');

  const chips: { value: DishFilter; label: string }[] = [
    { value: 'ALL', label: '🍽️ All Items' },
    { value: 'VEG', label: '🟢 Veg Thali (₹99)' },
    { value: 'NONVEG', label: '🔴 Non-Veg Chicken (₹149)' },
    { value: 'ROTI', label: '🫓 Roti Thali' },
    { value: 'PARATHA', label: '🥞 Paratha Thali' },
  ];

  const shown = dishes.filter((d) => {
    if (filter === 'ALL') return true;
    if (filter === 'VEG') return d.isVeg;
    if (filter === 'NONVEG') return !d.isVeg;
    return d.bread === filter;
  });

  return (
    <>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setFilter(c.value)}
            aria-pressed={filter === c.value}
            className={`pos-tap rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
              filter === c.value
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-10 text-center text-ink-400">
          Nothing on today&rsquo;s menu matches that. Try &ldquo;All Items&rdquo;.
        </p>
      ) : (
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((d) => (
            <div key={d.key}>{d.node}</div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Subscription plans, with the enquiry chips above them.
 *
 * A subscription enquiry that arrives as "I want a monthly plan" costs two more messages to
 * turn into something the kitchen can plan around. Carrying the diet and the shift into the
 * WhatsApp message makes the first message the useful one — which is why the cards live in
 * here with the chips rather than beside them.
 */
export interface SubscriptionPlan {
  badge: string;
  title: string;
  body: string;
  points: string[];
  cta: string;
  note: string;
  popular: boolean;
}

export function SubscriptionPlans({ plans }: { plans: SubscriptionPlan[] }) {
  const [diet, setDiet] = useState('Veg');
  const [shift, setShift] = useState('Lunch');

  const groups = [
    {
      label: 'Dietary preference',
      value: diet,
      set: setDiet,
      options: ['🟢 Veg', '🔴 Non-Veg (Chicken)', '🍽️ Mixed'],
    },
    {
      label: 'Meal delivery shift',
      value: shift,
      set: setShift,
      options: ['☀️ Lunch', '🌙 Dinner', '✨ Both'],
    },
  ];

  const message = (plan: string) =>
    `Hello Mithila Kitchen, I'd like to enquire about the ${plan}.\nDietary preference: ${diet}\nMeal delivery shift: ${shift}`;

  return (
    <>
      <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
        {groups.map((g) => (
          <fieldset key={g.label} className="rounded-xl border border-ink-200 bg-white p-4">
            <legend className="px-1 text-[10px] font-extrabold uppercase tracking-[0.15em] text-ink-400">
              {g.label}
            </legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {g.options.map((o) => {
                const plain = o.replace(/^\S+\s/, '');
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => g.set(plain)}
                    aria-pressed={g.value === plain}
                    className={`pos-tap rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                      g.value === plain
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-ink-200 text-ink-600 hover:border-brand-300'
                    }`}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {plans.map((p) => (
          <div
            key={p.badge}
            className={`relative rounded-2xl border-2 bg-white p-6 ${
              p.popular ? 'border-brand-500 shadow-md' : 'border-ink-200'
            }`}
          >
            {p.popular ? (
              <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.15em] text-white">
                Most popular
              </span>
            ) : null}
            <Eyebrow>{p.badge}</Eyebrow>
            <h3 className="mt-2 font-display text-xl font-bold text-ink-900">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">{p.body}</p>
            <ul className="mt-4 space-y-1.5">
              {p.points.map((pt) => (
                <li key={pt} className="flex items-start gap-2 text-sm text-ink-600">
                  <CheckGlyph />
                  {pt}
                </li>
              ))}
            </ul>
            <a
              href={whatsappLink(message(p.title))}
              target="_blank"
              rel="noreferrer noopener"
              className={`pos-tap mt-5 flex items-center justify-center gap-2 rounded-lg px-4 py-3 font-bold text-white ${
                p.popular ? 'bg-brand-600 hover:bg-brand-700' : 'bg-wa-500 hover:bg-wa-600'
              }`}
            >
              <WhatsAppGlyph className="h-4 w-4" />
              {p.cta}
            </a>
            <p className="mt-2 text-center text-xs text-ink-400">{p.note}</p>
          </div>
        ))}
      </div>
    </>
  );
}

export function CheckGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-leaf-500" fill="currentColor" aria-hidden>
      <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0z" />
    </svg>
  );
}

/**
 * Corporate quote form.
 *
 * Nothing is posted to a server: the fields are assembled into a WhatsApp message and
 * handed to the same number as every other enquiry. That is deliberate at this stage —
 * there is no one watching an inbox, and a form that silently drops leads is worse than no
 * form. When corporate volume justifies it this becomes a real lead record in the CRM.
 */
export function CorporateQuoteForm() {
  const [f, setF] = useState({
    company: '',
    employees: '',
    requirement: 'Office Lunch',
    frequency: 'Daily (Recurring)',
    location: '',
    contact: '',
  });

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const ready = f.company.trim() !== '' && f.employees.trim() !== '' && f.contact.trim() !== '';

  const href = whatsappLink(
    [
      `Hello Mithila Kitchen, we'd like corporate pricing for ${SHOP.city}.`,
      `Company: ${f.company || '—'}`,
      `Employees: ${f.employees || '—'}`,
      `Requirement: ${f.requirement}`,
      `Frequency: ${f.frequency}`,
      `Office location: ${f.location || '—'}`,
      `Contact: ${f.contact || '—'}`,
    ].join('\n'),
  );

  const field = 'mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none focus:border-brand-400';
  const label = 'text-[10px] font-extrabold uppercase tracking-[0.15em] text-ink-400';

  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-ink-900">Quick Corporate Quote Form</h3>
        <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-wa-600">
          Instant WA dispatch
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Company name</span>
          <input className={field} value={f.company} onChange={set('company')} placeholder="Acme Technologies" />
        </label>
        <label className="block">
          <span className={label}>Number of employees</span>
          <input
            className={field}
            value={f.employees}
            onChange={set('employees')}
            inputMode="numeric"
            placeholder="40"
          />
        </label>
        <label className="block">
          <span className={label}>Meal requirement</span>
          <select className={field} value={f.requirement} onChange={set('requirement')}>
            <option>Office Lunch</option>
            <option>Late Shift Dinner</option>
            <option>Both Lunch &amp; Dinner</option>
          </select>
        </label>
        <label className="block">
          <span className={label}>Frequency</span>
          <select className={field} value={f.frequency} onChange={set('frequency')}>
            <option>Daily (Recurring)</option>
            <option>Weekly (Mon - Fri)</option>
            <option>Team Event / Meeting</option>
            <option>Monthly Corporate Contract</option>
          </select>
        </label>
        <label className="block">
          <span className={label}>Office location / tech park</span>
          <input className={field} value={f.location} onChange={set('location')} placeholder="WaveRock, Nanakramguda" />
        </label>
        <label className="block">
          <span className={label}>Contact person &amp; phone</span>
          <input className={field} value={f.contact} onChange={set('contact')} placeholder="Priya · 98765 43210" />
        </label>
      </div>

      <a
        href={ready ? href : undefined}
        target="_blank"
        rel="noreferrer noopener"
        aria-disabled={!ready}
        className={`pos-tap mt-4 flex items-center justify-center gap-2 rounded-lg px-5 py-3 font-bold text-white ${
          ready ? 'bg-wa-500 hover:bg-wa-600' : 'pointer-events-none bg-ink-200'
        }`}
      >
        <WhatsAppGlyph className="h-4 w-4" />
        Request Corporate Pricing via WhatsApp
      </a>
      {!ready ? (
        <p className="mt-2 text-center text-xs text-ink-400">
          Company, team size and a contact number are enough to get a quote back.
        </p>
      ) : null}
    </div>
  );
}
