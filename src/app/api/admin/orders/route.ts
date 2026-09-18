import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const paymentStatus = url.searchParams.get("paymentStatus");

  const service = createSupabaseServiceClient();
  let query = service
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  // Default: only paid orders count as "the order list". Pass
  // paymentStatus=issues for the admin's separate failed/cancelled/incomplete
  // payments view, or paymentStatus=all to bypass this filter entirely.
  if (paymentStatus === "issues") {
    query = query.neq("payment_status", "paid");
  } else if (paymentStatus !== "all") {
    query = query.eq("payment_status", "paid");
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Failed to load orders" }, { status: 500 });
  }

  return NextResponse.json({ orders: data });
}
