"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatRupees, ORDER_STATUS_COLORS, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/constants";

interface TrackedOrder {
  order_code: string;
  status: OrderStatus;
  payment_status: string;
  total_paise: number;
  created_at: string;
}

interface TrackedItem {
  item_name: string;
  quantity: number;
  unit_price_paise: number;
}

function TrackForm() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState(searchParams.get("code") || "");
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [items, setItems] = useState<TrackedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const justPaid = searchParams.get("justPaid") === "1";

  async function lookup(trackCode: string) {
    if (!trackCode.trim()) return;
    setLoading(true);
    setError(null);
    setOrder(null);
    try {
      const res = await fetch(`/api/orders/track/${encodeURIComponent(trackCode.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Order not found");
        return;
      }
      setOrder(data.order);
      setItems(data.items);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (searchParams.get("code")) {
      lookup(searchParams.get("code")!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold text-indigo">Track your order</h1>
      {justPaid && (
        <p className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-700">
          Payment received! Your order is confirmed.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup(code);
        }}
        className="mb-6 flex gap-2"
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Order ID, e.g. MK-AB12CD"
          className="flex-1 rounded-xl border border-mustard/40 px-4 py-3"
        />
        <button type="submit" className="btn-primary px-5" disabled={loading}>
          {loading ? "..." : "Track"}
        </button>
      </form>

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {order && (
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-lg font-bold text-indigo">{order.order_code}</p>
            <span className={`badge-status ${ORDER_STATUS_COLORS[order.status]}`}>
              {ORDER_STATUS_LABELS[order.status]}
            </span>
          </div>

          <ol className="mb-4 flex justify-between text-xs">
            {(["new", "preparing", "out_for_delivery", "delivered"] as OrderStatus[]).map(
              (s, idx) => {
                const currentIdx = ["new", "preparing", "out_for_delivery", "delivered"].indexOf(
                  order.status
                );
                const reached = idx <= currentIdx;
                return (
                  <li key={s} className="flex flex-1 flex-col items-center text-center">
                    <div
                      className={`mb-1 h-3 w-3 rounded-full ${
                        reached ? "bg-maroon" : "bg-mustard/20"
                      }`}
                    />
                    <span className={reached ? "font-semibold text-indigo" : "text-indigo/40"}>
                      {ORDER_STATUS_LABELS[s]}
                    </span>
                  </li>
                );
              }
            )}
          </ol>

          <ul className="mb-3 divide-y divide-mustard/20 border-t border-mustard/20 pt-2">
            {items.map((i, idx) => (
              <li key={idx} className="flex justify-between py-2 text-sm">
                <span>
                  {i.item_name} × {i.quantity}
                </span>
                <span>{formatRupees(i.unit_price_paise * i.quantity)}</span>
              </li>
            ))}
          </ul>

          <div className="flex justify-between border-t border-mustard/30 pt-3 font-bold text-indigo">
            <span>Total</span>
            <span>{formatRupees(order.total_paise)}</span>
          </div>
          {order.payment_status !== "paid" && (
            <p className="mt-2 text-sm text-maroon">Payment status: {order.payment_status}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function TrackPage() {
  return (
    <Suspense fallback={<div className="px-4 py-8 text-center text-indigo/60">Loading…</div>}>
      <TrackForm />
    </Suspense>
  );
}
