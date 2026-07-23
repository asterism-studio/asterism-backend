# Consultation Schema & RLS 權限清單

> 範圍：`consultants`、`consultation_bookings`、`consultation_payments`、`stripe_webhook_events`  
> 身分模型：一般使用者與顧問帳號都以 `profile_id = auth.uid()` 識別。  
> 原則：client 不可直接控制 booking/payment 狀態、金額、顧問配對或 Stripe 欄位。

---

## Schema constraints

### `consultants`

| 欄位 | 約束 |
|---|---|
| `specialty` | `ConsultantSpecialty` enum：`spatial`、`visual_styling`、`concept_design` |
| `is_active` | Boolean，default `true` |
| `display_name` | `VARCHAR(80)`，NOT NULL |
| `title` | `VARCHAR(80)`，NOT NULL |
| `profile_id` | nullable、unique，FK → `profiles.id`，`ON DELETE SET NULL` |

### `consultation_bookings`

| 欄位 | 約束 |
|---|---|
| `method` | `ConsultationMethod` enum：`online`、`in_person` |
| `time_slot` | `ConsultationTimeSlot` enum：`am`、`pm` |
| `status` | `ConsultationBookingStatus` enum：`pending_payment`、`confirmed`、`payment_failed`、`canceled`、`completed` |
| `profile_id` | FK → `profiles.id`，`ON DELETE RESTRICT` |
| `consultant_id` | nullable，FK → `consultants.id`，`ON DELETE SET NULL` |
| `source_image_id` | nullable，FK → `images.id`，`ON DELETE SET NULL` |
| `idempotency_key` | UUID；與 `profile_id` 組成 unique constraint |
| `location` | nullable TEXT；只能由被指派顧問透過 RPC 更新 |

同日期、時段若已有 `pending_payment`、`confirmed` 或 `completed` booking，partial unique index 會阻止另一筆有效 booking：

```sql
CREATE UNIQUE INDEX "consultation_bookings_slot_unique"
ON "consultation_bookings"("consultation_date", "time_slot")
WHERE "status" IN ('pending_payment', 'confirmed', 'completed');
```

`pending_payment` 草稿的有效期由 `consultation_payments.checkout_expires_at` 判斷；建立新草稿前，後端會先把同時段已過期的 booking/payment 標記為 `canceled`。

### `consultation_payments`

| 欄位 | 約束 |
|---|---|
| `booking_id` | unique，FK → `consultation_bookings.id`，`ON DELETE CASCADE` |
| `provider` | `ConsultationPaymentProvider` enum，目前只有 `stripe` |
| `amount` | INTEGER，`CHECK (amount > 0)` |
| `currency` | `VARCHAR(3)`，default `TWD`，`CHECK (currency = 'TWD')` |
| `status` | `ConsultationPaymentStatus` enum：`pending`、`paid`、`failed`、`canceled`、`refunded` |
| `provider_checkout_session_id` | nullable、unique；建立 Stripe session 後才寫入 |
| `provider_payment_intent_id` | nullable、unique |
| `provider_refund_id` | nullable、unique |
| `checkout_expires_at` | nullable timestamp；pending checkout 的到期時間 |

### `stripe_webhook_events`

| 欄位 | 約束 |
|---|---|
| `stripe_event_id` | unique，作為 webhook idempotency key |
| `payload` | JSONB，NOT NULL |
| `processed_at` | nullable timestamp |
| `processing_error` | nullable TEXT |

### 尚未由 DB 強制的規則

- Booking 與 payment 的合法狀態轉換仍由 application/service code 維護，DB 沒有狀態機 trigger 或 CHECK。
- `checkout_expires_at` 與 `pending_payment` 的一致性由後端維護。

---

## Indexes

| 資料表 | Index | 類型／用途 |
|---|---|---|
| `consultants` | `profile_id` | unique；一個 profile 最多連結一位顧問 |
| `consultants` | `specialty` | 顧問配對查詢 |
| `consultants` | `is_active` | active 顧問查詢 |
| `consultation_bookings` | `(profile_id, idempotency_key)` | unique；checkout request idempotency |
| `consultation_bookings` | `(consultation_date, time_slot)`，限有效狀態 | unique；時段鎖 |
| `consultation_bookings` | `(profile_id, consultation_date, time_slot, id)` | 使用者預約列表與 cursor pagination |
| `consultation_bookings` | `consultant_id` | 顧問指派查詢 |
| `consultation_bookings` | `source_image_id` | source image relation |
| `consultation_payments` | `booking_id` | unique；一筆 booking 最多一筆 payment |
| `consultation_payments` | `provider_checkout_session_id` | unique |
| `consultation_payments` | `provider_payment_intent_id` | unique |
| `consultation_payments` | `provider_refund_id` | unique |
| `stripe_webhook_events` | `stripe_event_id` | unique；webhook idempotency |

---

## RLS 權限總覽

| 資料表 | anon | authenticated user | backend / service role |
|---|---|---|---|
| `consultants` | SELECT active 顧問 | SELECT active 顧問；顧問也可 SELECT 自己連結的資料 | 完整管理 |
| `consultation_bookings` | 無權限 | 客戶可 SELECT 自己的 booking；顧問可 SELECT 指派給自己的 booking | 建立、讀取、更新 |
| `consultation_payments` | 無權限 | SELECT 自己 booking 關聯的 payment | 建立、讀取、更新 |
| `stripe_webhook_events` | 無權限 | 無權限 | 建立、讀取、更新 |

沒有提供 client-facing 的 table `INSERT`、`UPDATE` 或 `DELETE` policy。顧問修改地點是透過下述 `SECURITY DEFINER` RPC，不是直接 UPDATE table。

### `consultants` SELECT policies

```sql
CREATE POLICY "consultants_public_read_active" ON "consultants"
    FOR SELECT TO anon, authenticated
    USING ("is_active" = true);

CREATE POLICY "consultants_select_own" ON "consultants"
    FOR SELECT TO authenticated
    USING ("profile_id" = auth.uid());
```

第二個 policy 讓顧問即使目前不是 active，也能解析自己的 consultant 身分。

### `consultation_bookings` SELECT policies

```sql
CREATE POLICY "consultation_bookings_select_own" ON "consultation_bookings"
    FOR SELECT TO authenticated
    USING ("profile_id" = auth.uid());

CREATE POLICY "consultation_bookings_select_assigned" ON "consultation_bookings"
    FOR SELECT TO authenticated
    USING ("consultant_id" IN (
        SELECT "id" FROM "consultants" WHERE "profile_id" = auth.uid()
    ));
```

兩個 SELECT policy 是 OR 關係：客戶能讀自己的預約，顧問能讀指派給自己的預約。

### `consultation_payments` SELECT policy

```sql
CREATE POLICY "consultation_payments_select_own" ON "consultation_payments"
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM "consultation_bookings" AS booking
            WHERE booking."id" = "consultation_payments"."booking_id"
              AND booking."profile_id" = auth.uid()
        )
    );
```

顧問不能透過 client 直接讀 payment；只有 booking owner 可以。

### `stripe_webhook_events`

此表已啟用 RLS，但沒有 `anon` 或 `authenticated` policy，因此只有 backend/service role 可存取。

---

## 顧問設定 consultation location

Authenticated 顧問可呼叫：

```sql
public.set_consultation_location(p_booking_id uuid, p_location text)
```

RPC 使用 `SECURITY DEFINER` 並固定 `search_path = public`，只會更新同時符合以下條件的 booking：

- `status = 'confirmed'`
- `consultant_id` 對應到 `profile_id = auth.uid()` 的顧問

輸入會先 `btrim`；空字串轉成 `NULL`。找不到可更新資料時會拋出 SQLSTATE `42501`。執行權只授予 `authenticated`，`public` 與 `anon` 已撤銷。

---

## 後端流程

### 建立或恢復 checkout

```txt
Frontend
→ Backend 驗證 auth、request 與 idempotency key
→ 讀取並驗證 Stripe price
→ transaction：釋放過期草稿、檢查時段、依 design_field 配對 active 顧問
→ upsert consultation_booking（pending_payment）與 consultation_payment（pending）
→ 建立或恢復 Stripe Checkout Session
→ 寫入 provider_checkout_session_id / checkout_expires_at
→ 回傳 checkout URL
```

目前顧問配對發生在 checkout draft transaction。未知的 `design_field` 會保留未指派，不由 webhook 補配。

### Stripe webhook

```txt
Stripe webhook
→ 驗證 Stripe signature
→ 以 stripe_event_id 記錄或恢復 event
→ completed：payment → paid，booking → confirmed
→ expired：payment → canceled，booking → canceled
→ 寫入 processed_at；失敗則記錄 processing_error 供重試
```

---

## 設計決策

- booking/payment 不開放 client 直接寫入；取消使用狀態流轉，不做日常 hard delete。
- `consultation_payments.booking_id` 保留 `ON DELETE CASCADE`，因 payment 的生命週期依附 booking。
- `stripe_webhook_events` 為 backend-only，避免 payload 外洩或 idempotency 紀錄遭干擾。
- 顧問只能透過受限 RPC 修改指派給自己的 confirmed booking 的 `location`。
