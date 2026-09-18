export const KITCHEN_NAME = process.env.NEXT_PUBLIC_KITCHEN_NAME || "MithilaKitchen";
export const KITCHEN_CITY = process.env.NEXT_PUBLIC_KITCHEN_CITY || "Hyderabad";
export const FSSAI_NUMBER = process.env.NEXT_PUBLIC_FSSAI_NUMBER || "";
export const WHATSAPP_BUSINESS_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER || "";

export const ORDER_STATUSES = [
  "new",
  "preparing",
  "out_for_delivery",
  "delivered",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "New",
  preparing: "Preparing",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  new: "bg-indigo/10 text-indigo",
  preparing: "bg-mustard/20 text-mustard",
  out_for_delivery: "bg-maroon/10 text-maroon",
  delivered: "bg-green-100 text-green-700",
};

export function nextStatus(status: OrderStatus): OrderStatus | null {
  const idx = ORDER_STATUSES.indexOf(status);
  if (idx === -1 || idx === ORDER_STATUSES.length - 1) return null;
  return ORDER_STATUSES[idx + 1];
}

export function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(0)}`;
}
