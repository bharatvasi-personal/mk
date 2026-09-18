-- Seed the initial thali menu. Safe to re-run: matches on name.
insert into public.items (name, description, price_paise, is_veg, sold_out, display_order)
values
  ('Mithila Veg Thali', 'Seasonal sabzi, dal, rice, roti, achar & a sweet.', 15000, true, false, 1),
  ('Litti Chokha Thali', 'Sattu-stuffed litti with baingan-aloo chokha & ghee.', 17000, true, false, 2),
  ('Macch Bhaat Thali', 'Bihar-style fish curry with steamed rice & dal.', 19000, false, false, 3),
  ('Home-Style Chicken Thali', 'Slow-cooked chicken curry, rice, roti & salad.', 21000, false, false, 4),
  ('Simple Dal-Chawal Thali', 'Comfort dal, steamed rice, ghee & papad.', 11000, true, false, 5)
on conflict (name) do nothing;
