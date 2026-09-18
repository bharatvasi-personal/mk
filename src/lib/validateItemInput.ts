export interface ItemFieldsInput {
  name?: unknown;
  description?: unknown;
  pricePaise?: unknown;
  discountPricePaise?: unknown;
  isVeg?: unknown;
  soldOut?: unknown;
  imageUrl?: unknown;
  displayOrder?: unknown;
}

export interface ItemFieldsDb {
  name?: string;
  description?: string;
  price_paise?: number;
  discount_price_paise?: number | null;
  is_veg?: boolean;
  sold_out?: boolean;
  image_url?: string | null;
  display_order?: number;
}

/** Validates and maps camelCase item fields from a request body to DB column names. Only keys present in the input are included, so it works for both create and partial update. */
export function parseItemFields(body: ItemFieldsInput): { data: ItemFieldsDb } | { error: string } {
  const out: ItemFieldsDb = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return { error: "name must be a non-empty string" };
    }
    out.name = body.name.trim();
  }

  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      return { error: "description must be a string" };
    }
    out.description = body.description.trim();
  }

  if (body.pricePaise !== undefined) {
    if (!Number.isInteger(body.pricePaise) || (body.pricePaise as number) <= 0) {
      return { error: "pricePaise must be a positive integer" };
    }
    out.price_paise = body.pricePaise as number;
  }

  if (body.discountPricePaise !== undefined) {
    if (body.discountPricePaise === null) {
      out.discount_price_paise = null;
    } else if (!Number.isInteger(body.discountPricePaise) || (body.discountPricePaise as number) <= 0) {
      return { error: "discountPricePaise must be a positive integer or null" };
    } else {
      const price = out.price_paise;
      if (price !== undefined && (body.discountPricePaise as number) >= price) {
        return { error: "discountPricePaise must be less than pricePaise" };
      }
      out.discount_price_paise = body.discountPricePaise as number;
    }
  }

  if (body.isVeg !== undefined) {
    if (typeof body.isVeg !== "boolean") {
      return { error: "isVeg must be a boolean" };
    }
    out.is_veg = body.isVeg;
  }

  if (body.soldOut !== undefined) {
    if (typeof body.soldOut !== "boolean") {
      return { error: "soldOut must be a boolean" };
    }
    out.sold_out = body.soldOut;
  }

  if (body.imageUrl !== undefined) {
    if (body.imageUrl !== null && typeof body.imageUrl !== "string") {
      return { error: "imageUrl must be a string or null" };
    }
    out.image_url = body.imageUrl as string | null;
  }

  if (body.displayOrder !== undefined) {
    if (!Number.isInteger(body.displayOrder)) {
      return { error: "displayOrder must be an integer" };
    }
    out.display_order = body.displayOrder as number;
  }

  return { data: out };
}
