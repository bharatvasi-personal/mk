import { API_URL, DEFAULT_TENANT } from './config';

/**
 * Server-side fetch for the public pages.
 *
 * The public menu is rendered on the server and revalidated, not fetched in the browser:
 * "home food Tellapur" is the acquisition channel, so the menu has to be in the HTML for
 * Google, and the first paint has to be fast on a ₹8,000 Android phone over 4G.
 */
export async function serverGet<T>(path: string, revalidateSeconds = 120): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}/api${path}`, {
      headers: { 'X-Tenant': DEFAULT_TENANT },
      next: { revalidate: revalidateSeconds },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // The public site must still render if the API is briefly unavailable — a visitor
    // looking for the address should not get a 500 because a container is restarting.
    return null;
  }
}

export interface PublicBranch {
  id: string;
  code: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pincode: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  operatingHours: Record<string, { open: string; close: string } | null>;
  openingDate: string | null;
}

export interface PublicMenuVariant {
  branchMenuItemId: string;
  variantId: string;
  name: string;
  nameI18n: Record<string, string> | null;
  mealSlot: string;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  gstRateBp: number;
  isSoldOut: boolean;
  dailyLimit: number | null;
}

export interface PublicMenuItem {
  id: string;
  name: string;
  nameI18n: Record<string, string> | null;
  slug: string;
  description: string | null;
  descriptionI18n: Record<string, string> | null;
  foodType: 'VEG' | 'NON_VEG' | 'EGG' | 'JAIN';
  isLessOil: boolean;
  isMithilaSpecial: boolean;
  isChefSpecial: boolean;
  spiceLevel: number | null;
  allergens: string[];
  variants: PublicMenuVariant[];
}

export interface PublicMenuCategory {
  id: string;
  name: string;
  nameI18n: Record<string, string> | null;
  slug: string;
  sortOrder: number;
  mealSlot: string;
  items: PublicMenuItem[];
}
