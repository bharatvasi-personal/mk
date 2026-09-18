import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { parseItemFields } from "@/lib/validateItemInput";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseItemFields((body as Record<string, unknown>) || {});
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // discountPricePaise alone (without pricePaise in the same request) is only
  // validated against the incoming price above — re-check against the
  // existing row's price so an edit that changes only the discount can't
  // sneak past the DB constraint with a confusing 500.
  if (parsed.data.discount_price_paise != null && parsed.data.price_paise === undefined) {
    const { data: existing } = await service
      .from("items")
      .select("price_paise")
      .eq("id", id)
      .maybeSingle();
    if (existing && parsed.data.discount_price_paise >= (existing as any).price_paise) {
      return NextResponse.json(
        { error: "discountPricePaise must be less than the item's price" },
        { status: 400 }
      );
    }
  }

  const { data, error } = await service
    .from("items")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to update item" }, { status: 500 });
  }

  return NextResponse.json({ item: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createSupabaseServiceClient();
  const { error } = await service.from("items").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete item" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
