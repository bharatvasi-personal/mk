export type OrderStatusDB = "new" | "preparing" | "out_for_delivery" | "delivered";
export type PaymentStatusDB = "pending" | "paid" | "failed" | "cancelled";

export interface ItemRow {
  id: string;
  name: string;
  description: string;
  price_paise: number;
  discount_price_paise: number | null;
  image_url: string | null;
  is_veg: boolean;
  sold_out: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface OrderRow {
  id: string;
  order_code: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  notes: string;
  status: OrderStatusDB;
  subtotal_paise: number;
  total_paise: number;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  razorpay_signature: string | null;
  payment_status: PaymentStatusDB;
  payment_failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  item_id: string | null;
  item_name: string;
  unit_price_paise: number;
  quantity: number;
  created_at: string;
}

export interface AdminUserRow {
  user_id: string;
  display_name: string;
  role: "staff" | "owner";
  created_at: string;
}
