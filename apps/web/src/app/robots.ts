import type { MetadataRoute } from 'next';
import { API_URL } from '@/lib/config';

/**
 * Staff surfaces are excluded from indexing.
 *
 * They are already behind authentication, but a crawler hammering /pos or an admin URL
 * appearing in a search result is noise nobody needs.
 */
export default function robots(): MetadataRoute.Robots {
  void API_URL;
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/*/pos', '/*/admin', '/*/kitchen', '/*/punch', '/*/login', '/*/order'] }],
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mithilakitchen.in'}/sitemap.xml`,
  };
}
