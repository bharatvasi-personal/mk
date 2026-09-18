"use client";

import { useEffect, useState } from "react";
import ItemForm from "./ItemForm";
import { formatRupees } from "@/lib/constants";
import type { ItemRow } from "@/lib/supabase/types";

type SavePayload = {
  name: string;
  description: string;
  pricePaise: number;
  discountPricePaise: number | null;
  isVeg: boolean;
  soldOut: boolean;
  imageUrl: string | null;
};

export default function MenuManager() {
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/menu");
    if (res.ok) setItems((await res.json()).items);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(payload: SavePayload) {
    const res = await fetch("/api/admin/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return data.error || "Failed to create item";
    setCreating(false);
    load();
  }

  async function handleUpdate(id: string, payload: SavePayload) {
    const res = await fetch(`/api/admin/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return data.error || "Failed to update item";
    setEditingId(null);
    load();
  }

  async function handleDelete(item: ItemRow) {
    if (!confirm(`Delete "${item.name}"? This can't be undone.`)) return;
    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/admin/items/${item.id}`, { method: "DELETE" });
      if (res.ok) setItems((prev) => prev?.filter((i) => i.id !== item.id) || null);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleQuickToggle(item: ItemRow) {
    const res = await fetch(`/api/admin/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ soldOut: !item.sold_out }),
    });
    if (res.ok) {
      setItems(
        (prev) =>
          prev?.map((i) => (i.id === item.id ? { ...i, sold_out: !item.sold_out } : i)) || null
      );
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-indigo">Menu</h2>
        {!creating && (
          <button onClick={() => setCreating(true)} className="btn-secondary px-4 py-2 text-sm">
            + Add item
          </button>
        )}
      </div>

      {creating && (
        <ItemForm onSave={handleCreate} onCancel={() => setCreating(false)} />
      )}

      <div className="space-y-3">
        {items?.map((item) =>
          editingId === item.id ? (
            <ItemForm
              key={item.id}
              item={item}
              onSave={(payload) => handleUpdate(item.id, payload)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={item.id} className="card flex items-center gap-3 p-3">
              {item.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.image_url}
                  alt=""
                  className="h-14 w-14 flex-shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="h-14 w-14 flex-shrink-0 rounded-lg bg-mustard/10" />
              )}
              <div className="min-w-0 flex-1">
                <p className={`font-semibold ${item.sold_out ? "text-indigo/40 line-through" : "text-indigo"}`}>
                  {item.name}
                </p>
                <p className="truncate text-xs text-indigo/60">{item.description}</p>
                <p className="text-sm font-semibold text-maroon">
                  {item.discount_price_paise ? (
                    <>
                      <span className="mr-2 text-indigo/40 line-through">
                        {formatRupees(item.price_paise)}
                      </span>
                      {formatRupees(item.discount_price_paise)}
                    </>
                  ) : (
                    formatRupees(item.price_paise)
                  )}
                </p>
              </div>
              <label className="flex flex-shrink-0 flex-col items-center gap-1 text-[10px] text-indigo/60">
                <input
                  type="checkbox"
                  checked={!item.sold_out}
                  onChange={() => handleQuickToggle(item)}
                  className="h-5 w-5 accent-maroon"
                />
                In stock
              </label>
              <div className="flex flex-shrink-0 flex-col gap-1">
                <button
                  onClick={() => setEditingId(item.id)}
                  className="rounded-full border border-indigo/30 px-3 py-1 text-xs font-semibold text-indigo"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(item)}
                  disabled={deletingId === item.id}
                  className="rounded-full border border-maroon/30 px-3 py-1 text-xs font-semibold text-maroon"
                >
                  {deletingId === item.id ? "..." : "Delete"}
                </button>
              </div>
            </div>
          )
        )}
        {items?.length === 0 && !creating && (
          <p className="text-sm text-indigo/60">No menu items yet — add one above.</p>
        )}
      </div>
    </div>
  );
}
