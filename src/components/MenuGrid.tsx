"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/components/CartContext";
import { effectivePricePaise, formatRupees } from "@/lib/constants";
import type { ItemRow } from "@/lib/supabase/types";
import Link from "next/link";

export default function MenuGrid() {
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [error, setError] = useState(false);
  const { items: cartItems, addItem, setQuantity, totalPaise, totalCount } = useCart();

  useEffect(() => {
    fetch("/api/menu")
      .then((res) => res.json())
      .then((data) => setItems(data.items))
      .catch(() => setError(true));
  }, []);

  const quantityFor = (itemId: string) =>
    cartItems.find((i) => i.itemId === itemId)?.quantity || 0;

  return (
    <div className="pb-28">
      <header className="relative bg-maroon px-6 py-10 text-center text-cream">
        <Link
          href="/track"
          className="absolute right-4 top-4 text-sm font-semibold text-cream/90 underline underline-offset-2"
        >
          Track order
        </Link>
        <h1 className="font-display text-3xl font-bold">MithilaKitchen</h1>
        <p className="mt-2 text-cream/90">Home-style Bihar &amp; Mithila thalis, Hyderabad</p>
      </header>

      <section className="mx-auto max-w-3xl px-4 py-6">
        <h2 className="mb-4 text-xl font-bold text-indigo">Today&apos;s Menu</h2>

        {error && (
          <p className="rounded-xl bg-red-50 p-4 text-red-700">
            Couldn&apos;t load the menu. Please refresh.
          </p>
        )}

        {!items && !error && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card h-24 animate-pulse" />
            ))}
          </div>
        )}

        <div className="space-y-4">
          {items?.map((item) => {
            const qty = quantityFor(item.id);
            return (
              <div key={item.id} className="card flex items-center gap-4 p-4">
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="h-16 w-16 flex-shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div
                    className={`h-3 w-3 flex-shrink-0 rounded-full border-2 ${
                      item.is_veg ? "border-green-600" : "border-maroon"
                    }`}
                    aria-hidden
                  >
                    <div
                      className={`h-full w-full scale-50 rounded-full ${
                        item.is_veg ? "bg-green-600" : "bg-maroon"
                      }`}
                    />
                  </div>
                )}
                <div className="flex-1">
                  <p className="font-semibold text-indigo">{item.name}</p>
                  <p className="text-sm text-indigo/70">{item.description}</p>
                  <p className="mt-1 font-semibold text-maroon">
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
                {item.sold_out ? (
                  <span className="badge-status bg-gray-200 text-gray-600">Sold out</span>
                ) : qty === 0 ? (
                  <button
                    className="btn-primary px-4 py-2 text-sm"
                    onClick={() =>
                      addItem({
                        itemId: item.id,
                        name: item.name,
                        pricePaise: effectivePricePaise(item),
                      })
                    }
                  >
                    Add
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      className="h-8 w-8 rounded-full border-2 border-maroon text-maroon"
                      onClick={() => setQuantity(item.id, qty - 1)}
                      aria-label={`Remove one ${item.name}`}
                    >
                      −
                    </button>
                    <span className="w-4 text-center font-semibold">{qty}</span>
                    <button
                      className="h-8 w-8 rounded-full bg-maroon text-cream"
                      onClick={() => setQuantity(item.id, qty + 1)}
                      aria-label={`Add one ${item.name}`}
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {totalCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-mustard/30 bg-white p-4 shadow-lg">
          <Link
            href="/checkout"
            className="btn-primary mx-auto flex max-w-3xl items-center justify-between px-6"
          >
            <span>
              {totalCount} item{totalCount > 1 ? "s" : ""} in cart
            </span>
            <span>{formatRupees(totalPaise)} · Checkout →</span>
          </Link>
        </div>
      )}
    </div>
  );
}
