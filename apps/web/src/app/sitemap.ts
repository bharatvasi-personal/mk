import type { MetadataRoute } from 'next';
import { LOCALES } from '@/lib/i18n';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mithilakitchen.in';

/**
 * Only the three public pages, in all three languages.
 *
 * Every locale gets its own URL with hreflang alternates, because "home food Tellapur"
 * and its Telugu equivalent are different searches by different people, and both should
 * find the shop.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ['', '/menu', '/visit'];
  return LOCALES.flatMap((locale) =>
    paths.map((path) => ({
      url: `${SITE}/${locale}${path}`,
      lastModified: new Date(),
      changeFrequency: path === '/menu' ? ('daily' as const) : ('weekly' as const),
      priority: path === '' ? 1 : 0.8,
      alternates: {
        languages: Object.fromEntries(LOCALES.map((l) => [l, `${SITE}/${l}${path}`])),
      },
    })),
  );
}
