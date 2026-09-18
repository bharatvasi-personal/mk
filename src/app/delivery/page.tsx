"use client";

import { useEffect, useState } from "react";
import { formatRupees } from "@/lib/constants";

interface DeliveryOrder {
  id: string;
  order_code: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  total_paise: number;
  order_items: { item_name: string; quantity: number }[];
}

export default function DeliveryPage() {
  const [orders, setOrders] = useState<DeliveryOrder[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/orders?status=out_for_delivery");
    if (res.ok) setOrders((await res.json()).orders);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, []);

  async function markDelivered(order: DeliveryOrder) {
    setBusyId(order.id);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "delivered" }),
      });
      if (res.ok) {
        setOrders((prev) => prev?.filter((o) => o.id !== order.id) || null);
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-indigo">Out for Delivery</h1>

      {orders?.length === 0 && (
        <p className="text-sm text-indigo/60">No orders out for delivery right now.</p>
      )}

      {orders?.map((order) => (
        <div key={order.id} className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-bold text-indigo">{order.order_code}</p>
            <span className="font-semibold text-maroon">{formatRupees(order.total_paise)}</span>
          </div>
          <p className="mb-1 text-sm font-semibold text-indigo">{order.customer_name}</p>
          <p className="mb-3 text-sm text-indigo/70">{order.delivery_address}</p>
          <p className="mb-4 text-sm text-indigo/80">
            {order.order_items.map((oi) => `${oi.item_name} ×${oi.quantity}`).join(", ")}
          </p>

          <div className="grid grid-cols-3 gap-2">
            <a
              href={`tel:${order.customer_phone}`}
              className="btn-secondary py-2 text-sm"
            >
              Call
            </a>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                order.delivery_address
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary py-2 text-sm"
            >
              Navigate
            </a>
            <button
              onClick={() => markDelivered(order)}
              disabled={busyId === order.id}
              className="btn-primary py-2 text-sm"
            >
              {busyId === order.id ? "..." : "Delivered"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
