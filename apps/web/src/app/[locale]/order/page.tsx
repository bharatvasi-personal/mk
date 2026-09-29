import type { Metadata } from 'next';
import { getDictionary } from '@mk/shared';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { OrderFlow } from '@/components/order-flow';
import { serverGet, type PublicBranch, type PublicMenuCategory } from '@/lib/server-api';
import { resolveLocale } from '@/lib/i18n';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return { title: dict.nav.orderOnline, description: dict.home.ctaOrder, robots: { index: false } };
}

export default async function OrderPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const dict = getDictionary(locale);

  const branches = (await serverGet<PublicBranch[]>('/public/branches', 60)) ?? [];
  const branch = branches[0];
  const categories = branch ? ((await serverGet<PublicMenuCategory[]>(`/public/menu/${branch.id}`, 30)) ?? []) : [];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-display text-3xl font-bold text-brand-900">{dict.nav.orderOnline}</h1>
        <p className="mt-2 text-ink-600">{dict.checkout.pickupLabel}</p>
        {branch ? (
          <OrderFlow branch={branch} categories={categories} />
        ) : (
          <p className="mt-8 text-ink-400">{dict.common.error}</p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
