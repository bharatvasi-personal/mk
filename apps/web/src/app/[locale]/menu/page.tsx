import type { Metadata } from 'next';
import { getDictionary } from '@mk/shared';
import { MenuList } from '@/components/menu-list';
import { AnnouncementBar, FloatingWhatsApp, MarketingFooter, MarketingHeader, MobileActionBar } from '@/components/marketing';
import { serverGet, type PublicBranch, type PublicMenuCategory } from '@/lib/server-api';
import { resolveLocale } from '@/lib/i18n';
import { BRAND_NAME } from '@/lib/config';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return {
    title: dict.menu.title,
    description: `${dict.menu.title} — ${BRAND_NAME}, Osman Nagar, Tellapur. ${dict.menu.subtitle}`,
    alternates: { canonical: `/${locale}/menu`, languages: { en: '/en/menu', hi: '/hi/menu', te: '/te/menu' } },
  };
}

export default async function MenuPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const dict = getDictionary(locale);

  const branches = (await serverGet<PublicBranch[]>('/public/branches')) ?? [];
  const branch = branches[0];
  const categories = branch ? ((await serverGet<PublicMenuCategory[]>(`/public/menu/${branch.id}`)) ?? []) : [];

  return (
    <>
      <AnnouncementBar />
      <MarketingHeader />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-display text-3xl font-bold text-brand-900">{dict.menu.title}</h1>
        <p className="mt-2 text-ink-600">{dict.menu.subtitle}</p>
        <div className="mt-8">
          {branch ? (
            <MenuList categories={categories} />
          ) : (
            <p className="text-ink-400">{dict.common.error}</p>
          )}
        </div>
      </main>
      <MarketingFooter />
      <FloatingWhatsApp />
      <MobileActionBar />
    </>
  );
}
