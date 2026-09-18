import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { parseItemFields } from "@/lib/validateItemInput";

export const runtime = "nodejs";

export async function POST(req: Request) {
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
  if (!parsed.data.name || !parsed.data.price_paise) {
    return NextResponse.json({ error: "name and pricePaise are required" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("items")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? "",
      price_paise: parsed.data.price_paise,
      discount_price_paise: parsed.data.discount_price_paise ?? null,
      is_veg: parsed.data.is_veg ?? true,
      sold_out: parsed.data.sold_out ?? false,
      image_url: parsed.data.image_url ?? null,
      display_order: parsed.data.display_order ?? 0,
    })
    .select()
    .single();

  if (error) {
    if ((error as any).code === "23505") {
      return NextResponse.json({ error: "An item with that name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create item" }, { status: 500 });
  }

  return NextResponse.json({ item: data });
}
