-- AlterTable
ALTER TABLE "consultation_bookings" ADD COLUMN "location" TEXT;

-- 顧問可在預約狀態為 confirmed 且被指派給自己時,設定諮詢地點。
-- SECURITY DEFINER + 明確 WHERE 條件,只允許改自己被指派、狀態為 confirmed 的那一筆的 location 欄位。
CREATE OR REPLACE FUNCTION public.set_consultation_location(
  p_booking_id uuid,
  p_location text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE consultation_bookings b
     SET location   = nullif(btrim(p_location), ''),
         updated_at = now()
   WHERE b.id = p_booking_id
     AND b.status = 'confirmed'
     AND b.consultant_id in (
       select c.id from consultants c where c.profile_id = auth.uid()
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not authorized or booking not editable'
      USING errcode = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_consultation_location(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_consultation_location(uuid, text) TO authenticated;
