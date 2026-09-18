"use client";

import { useEffect, useState } from "react";
import {
  formatRupees,
  nextStatus,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from "@/lib/constants";
import type { ItemRow } from "@/lib/supabase/types";

interface AdminOrder {
  id: string;
  order_code: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  status: OrderStatus;
  payment_status: string;
  total_paise: number;
  created_at: string;
  order_items: { item_name: string; quantity: number }[];
}

interface Stats {
  orderCount: number;
  paidOrderCount: number;
  revenuePaise: number;
}

export default function AdminDashboardPage() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadAll() {
    const [ordersRes, statsRes, itemsRes] = await Promise.all([
      fetch("/api/admin/orders"),
      fetch("/api/admin/stats"),
      fetch("/api/menu"),
    ]);
    if (ordersRes.ok) setOrders((await ordersRes.json()).orders);
    if (statsRes.ok) setStats(await statsRes.json());
    if (itemsRes.ok) setItems((await itemsRes.json()).items);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function advanceStatus(order: AdminOrder) {
    const next = nextStatus(order.status);
    if (!next) return;
    setBusyId(order.id);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        setOrders(
          (prev) =>
            prev?.map((o) => (o.id === order.id ? { ...o, status: next } : o)) || null
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  async function toggleSoldOut(item: ItemRow) {
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
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs uppercase text-indigo/60">Today&apos;s Orders</p>
          <p className="text-2xl font-bold text-indigo">{stats?.orderCount ?? "—"}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase text-indigo/60">Paid Orders</p>
          <p className="text-2xl font-bold text-indigo">{stats?.paidOrderCount ?? "—"}</p>
        </div>
        <div className="card p-4 col-span-2 sm:col-span-1">
          <p className="text-xs uppercase text-indigo/60">Today&apos;s Revenue</p>
          <p className="text-2xl font-bold text-maroon">
            {stats ? formatRupees(stats.revenuePaise) : "—"}
          </p>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-bold text-indigo">Today&apos;s Availability</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {items?.map((item) => (
            <label
              key={item.id}
              className="card flex items-center justify-between p-3 text-sm"
            >
              <span className={item.sold_out ? "text-indigo/40 line-through" : "text-indigo"}>
                {item.name}
              </span>
              <input
                type="checkbox"
                checked={!item.sold_out}
                onChange={() => toggleSoldOut(item)}
                className="h-5 w-5 accent-maroon"
              />
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-indigo">Orders</h2>
        <div className="space-y-3">
          {orders?.map((order) => {
            const next = nextStatus(order.status);
            return (
              <div key={order.id} className="card p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-indigo">{order.order_code}</p>
                    <p className="text-sm text-indigo/70">
                      {order.customer_name} · {order.customer_phone}
                    </p>
                  </div>
                  <span className={`badge-status ${ORDER_STATUS_COLORS[order.status]}`}>
                    {ORDER_STATUS_LABELS[order.status]}
                  </span>
                </div>
                <p className="mb-2 text-sm text-indigo/70">{order.delivery_address}</p>
                <p className="mb-3 text-sm text-indigo/80">
                  {order.order_items.map((oi) => `${oi.item_name} ×${oi.quantity}`).join(", ")}
                </p>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-maroon">
                    {formatRupees(order.total_paise)}
                  </span>
                  {next && (
                    <button
                      onClick={() => advanceStatus(order)}
                      disabled={busyId === order.id}
                      className="btn-secondary px-4 py-2 text-sm"
                    >
                      {busyId === order.id ? "..." : `Mark ${ORDER_STATUS_LABELS[next]}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {orders?.length === 0 && (
            <p className="text-sm text-indigo/60">No orders yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
