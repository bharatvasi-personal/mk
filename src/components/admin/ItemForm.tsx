"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { ItemRow } from "@/lib/supabase/types";

export interface ItemFormValues {
  name: string;
  description: string;
  priceRupees: string;
  discountPriceRupees: string;
  isVeg: boolean;
  soldOut: boolean;
  imageUrl: string | null;
}

function toFormValues(item?: ItemRow): ItemFormValues {
  return {
    name: item?.name ?? "",
    description: item?.description ?? "",
    priceRupees: item ? String(item.price_paise / 100) : "",
    discountPriceRupees: item?.discount_price_paise ? String(item.discount_price_paise / 100) : "",
    isVeg: item?.is_veg ?? true,
    soldOut: item?.sold_out ?? false,
    imageUrl: item?.image_url ?? null,
  };
}

export default function ItemForm({
  item,
  onSave,
  onCancel,
}: {
  item?: ItemRow;
  onSave: (payload: {
    name: string;
    description: string;
    pricePaise: number;
    discountPricePaise: number | null;
    isVeg: boolean;
    soldOut: boolean;
    imageUrl: string | null;
  }) => Promise<string | void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<ItemFormValues>(() => toFormValues(item));
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("menu-images")
        .upload(path, file, { upsert: false });

      if (uploadError) {
        setError(`Image upload failed: ${uploadError.message}`);
        return;
      }

      const { data: publicUrlData } = supabase.storage.from("menu-images").getPublicUrl(path);
      setValues((v) => ({ ...v, imageUrl: publicUrlData.publicUrl }));
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const priceRupees = parseFloat(values.priceRupees);
    if (!values.name.trim() || Number.isNaN(priceRupees) || priceRupees <= 0) {
      setError("Name and a valid price are required");
      return;
    }

    let discountPricePaise: number | null = null;
    if (values.discountPriceRupees.trim()) {
      const discountRupees = parseFloat(values.discountPriceRupees);
      if (Number.isNaN(discountRupees) || discountRupees <= 0) {
        setError("Discount price must be a positive number");
        return;
      }
      discountPricePaise = Math.round(discountRupees * 100);
      if (discountPricePaise >= Math.round(priceRupees * 100)) {
        setError("Discount price must be less than the regular price");
        return;
      }
    }

    setSaving(true);
    try {
      const errMsg = await onSave({
        name: values.name.trim(),
        description: values.description.trim(),
        pricePaise: Math.round(priceRupees * 100),
        discountPricePaise,
        isVeg: values.isVeg,
        soldOut: values.soldOut,
        imageUrl: values.imageUrl,
      });
      if (errMsg) setError(errMsg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-indigo">Name</label>
          <input
            required
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            className="w-full rounded-lg border border-mustard/40 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-indigo">Type</label>
          <select
            value={values.isVeg ? "veg" : "non-veg"}
            onChange={(e) => setValues((v) => ({ ...v, isVeg: e.target.value === "veg" }))}
            className="w-full rounded-lg border border-mustard/40 px-3 py-2 text-sm"
          >
            <option value="veg">Veg</option>
            <option value="non-veg">Non-Veg</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-indigo">Description</label>
        <textarea
          value={values.description}
          onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
          rows={2}
          className="w-full rounded-lg border border-mustard/40 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-indigo">Price (₹)</label>
          <input
            required
            type="number"
            min="1"
            step="1"
            value={values.priceRupees}
            onChange={(e) => setValues((v) => ({ ...v, priceRupees: e.target.value }))}
            className="w-full rounded-lg border border-mustard/40 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-indigo">
            Discount price (₹, optional)
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={values.discountPriceRupees}
            onChange={(e) => setValues((v) => ({ ...v, discountPriceRupees: e.target.value }))}
            placeholder="Leave blank for no discount"
            className="w-full rounded-lg border border-mustard/40 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-indigo">Photo</label>
        <div className="flex items-center gap-3">
          {values.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={values.imageUrl}
              alt=""
              className="h-14 w-14 rounded-lg object-cover"
            />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            disabled={uploading}
            className="text-sm"
          />
          {uploading && <span className="text-xs text-indigo/60">Uploading...</span>}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.soldOut}
          onChange={(e) => setValues((v) => ({ ...v, soldOut: e.target.checked }))}
          className="h-4 w-4 accent-maroon"
        />
        Sold out today
      </label>

      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={saving || uploading} className="btn-primary px-4 py-2 text-sm">
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
