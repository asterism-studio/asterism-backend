-- 顧問帳號連結:consultants.profile_id -> profiles.id
-- 顧問身分只由 DB 端指定(demo 帳號手動連結),前端無任何入口可自行成為顧問。
ALTER TABLE "consultants" ADD COLUMN "profile_id" UUID;

CREATE UNIQUE INDEX "consultants_profile_id_key" ON "consultants"("profile_id");

ALTER TABLE "consultants" ADD CONSTRAINT "consultants_profile_id_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 顧問可讀自己的 consultant 列(既有 public policy 只放行 is_active = true,
-- 身分判定不能依賴它)。
CREATE POLICY "consultants_select_own" ON "consultants"
    FOR SELECT
    TO authenticated
    USING ("profile_id" = auth.uid());

-- 顧問可讀被指派給自己的預約。與既有 consultation_bookings_select_own(客人讀自己的)
-- 為 OR 關係,前端顧問清單查詢須自帶 consultant_id 過濾。
CREATE POLICY "consultation_bookings_select_assigned" ON "consultation_bookings"
    FOR SELECT
    TO authenticated
    USING ("consultant_id" IN (
        SELECT "id" FROM "consultants" WHERE "profile_id" = auth.uid()
    ));
