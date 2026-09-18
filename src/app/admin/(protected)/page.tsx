"use client";

import { useEffect, useState } from "react";
import MenuManager from "@/components/admin/MenuManager";
import {
  formatRupees,
  nextStatus,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
  PAYMENT_ISSUE_COLORS,
  PAYMENT_ISSUE_LABELS,
  type OrderStatus,
} from "@/lib/constants";

interface AdminOrder {
  id: string;
  order_code: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  status: OrderStatus;
  payment_status: string;
  payment_failure_reason: string | null;
  total_paise: number;
  created_at: string;
  order_items: { item_name: string; quantity: number }[];
}

interface Stats {
  orderCount: number;
  issueCount: number;
  revenuePaise: number;
}

export default function AdminDashboardPage() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [paymentIssues, setPaymentIssues] = useState<AdminOrder[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadAll() {
    const [ordersRes, issuesRes, statsRes] = await Promise.all([
      fetch("/api/admin/orders"),
      fetch("/api/admin/orders?paymentStatus=issues"),
      fetch("/api/admin/stats"),
    ]);
    if (ordersRes.ok) setOrders((await ordersRes.json()).orders);
    if (issuesRes.ok) setPaymentIssues((await issuesRes.json()).orders);
    if (statsRes.ok) setStats(await statsRes.json());
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

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs uppercase text-indigo/60">Today&apos;s Orders</p>
          <p className="text-2xl font-bold text-indigo">{stats?.orderCount ?? "—"}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase text-indigo/60">Payment Issues</p>
          <p className="text-2xl font-bold text-indigo">{stats?.issueCount ?? "—"}</p>
        </div>
        <div className="card p-4 col-span-2 sm:col-span-1">
          <p className="text-xs uppercase text-indigo/60">Today&apos;s Revenue</p>
          <p className="text-2xl font-bold text-maroon">
            {stats ? formatRupees(stats.revenuePaise) : "—"}
          </p>
        </div>
      </div>

      <section>
        <MenuManager />
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

      <section>
        <h2 className="mb-3 text-lg font-bold text-indigo">Payment Issues</h2>
        <p className="mb-3 text-sm text-indigo/60">
          Orders where checkout wasn&apos;t completed — failed, cancelled, or left
          incomplete. These aren&apos;t confirmed orders and don&apos;t need fulfillment.
        </p>
        <div className="space-y-3">
          {paymentIssues?.map((order) => (
            <div key={order.id} className="card p-4 opacity-80">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-indigo">{order.order_code}</p>
                  <p className="text-sm text-indigo/70">
                    {order.customer_name} · {order.customer_phone}
                  </p>
                </div>
                <span
                  className={`badge-status ${
                    PAYMENT_ISSUE_COLORS[order.payment_status] || "bg-gray-200 text-gray-600"
                  }`}
                >
                  {PAYMENT_ISSUE_LABELS[order.payment_status] || order.payment_status}
                </span>
              </div>
              <p className="text-sm text-indigo/80">
                {order.order_items.map((oi) => `${oi.item_name} ×${oi.quantity}`).join(", ")}
              </p>
              {order.payment_failure_reason && (
                <p className="mt-1 text-xs text-maroon">{order.payment_failure_reason}</p>
              )}
              <p className="mt-2 text-sm font-semibold text-indigo/70">
                {formatRupees(order.total_paise)}
              </p>
            </div>
          ))}
          {paymentIssues?.length === 0 && (
            <p className="text-sm text-indigo/60">No payment issues right now.</p>
          )}
        </div>
      </section>
    </div>
  );
}
