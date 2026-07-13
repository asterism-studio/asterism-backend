# 顧問預約與金流 API Contract

> 更新日期：2026-07-12
> 狀態：Planned  
> 版本：v1  
> 適用範圍：顧問預約、Stripe 金流、顧問配對、預約查詢  
> 架構定位：Supabase-first + Backend Worker Repo  
> 關聯文件：[顧問預約與金流技術規格設計書](./consultation-payment-technical-spec.md)

本文件定義顧問預約與金流相關 API contract，包含 endpoint、auth、headers、request body、response 與主要驗證規則。

---

## 1. API 設計原則

- API 使用 `/api/v1` 作為版本前綴。
- 需要使用者身份的 API 一律使用 `Authorization: Bearer <supabase_access_token>`。
- 後端必須從 Supabase Auth token 取得使用者身份，不接受前端傳入 `userId` / `profileId`。
- 金額、幣別、付款狀態、預約狀態、Stripe id、顧問媒合結果均不可由前端決定。
- Request body 應拒絕 unknown fields。
- `success_url` / `cancel_url` 只作為前端 UX 訊號，不代表實際付款結果。
- Stripe webhook 不使用一般使用者 auth，而是使用 Stripe signature 驗證來源。

---

## 2. Source of Truth

| 資料 | 真相來源 |
|---|---|
| `userId` | Supabase Auth session |
| `profileId` | 後端根據 `userId` 查詢 profiles |
| `email` | Supabase Auth / profiles |
| `contactEmail` | 後端從 Auth user email 產生快照 |
| `contactName` | 後端從 profiles 產生快照，MVP 可 nullable |
| `price` / `amount` | 後端 price config 或 Stripe Price ID |
| `currency` | 後端決定 |
| `paymentStatus` | Stripe webhook / 後端 payment service |
| `bookingStatus` | 後端 consultation service |
| `consultantId` | 後端 consultant-match service |
| `stripeSessionId` | Stripe Checkout Session 建立後由後端寫入 |
| `stripePaymentIntentId` | Stripe webhook 或 Stripe API 回寫 |
| `paidAt` | Stripe webhook 確認付款後寫入 |

---

## 3. 前端禁止傳入欄位

以下欄位不應由前端傳入或控制：

```txt
userId
profileId
role
isAdmin
price
amount
currency
status
bookingStatus
paymentStatus
consultantId
matchedConsultantId
createdAt
updatedAt
paidAt
stripeSessionId
stripePaymentIntentId
```

若 request body 出現上述欄位，後端應拒絕 unknown fields，或在 service 層明確忽略並覆寫。

---

## 4. Endpoint 總覽

| API | 優先級 | Auth | 用途 |
|---|---|---|---|
| `POST /api/v1/consultations/checkout` | 必做 | Required | 建立 booking / payment draft 與 Stripe Checkout Session |
| `POST /api/v1/payments/stripe/webhook` | 必做 | Stripe signature | 接收 Stripe event 並同步付款狀態 |
| `GET /api/v1/consultations/:bookingId` | 必做 | Required | 查詢單一預約與付款狀態 |
| `GET /api/v1/consultations/me` | 建議 | Required | 查詢自己的預約紀錄 |
| `GET /api/v1/consultations/availability` | 建議 | Required | 查詢指定日期或月份的可預約時段 |
| `GET /api/v1/consultants/match` | 視前端流程 | Required | 查詢前端顯示用媒合顧問 |
| `GET /api/v1/consultants` | 可選 | Optional / Required | 顯示 active consultants 公開資料 |
| `POST /api/v1/consultations/:bookingId/cancel` | 後續 | Required | 取消尚未付款或尚未完成的預約 |
| `POST /api/v1/payments/:paymentId/refund` | 後續 | Admin only | 建立退款 |

---

## 5. `POST /api/v1/consultations/checkout`

### 用途

建立 consultation booking、建立 pending payment、建立 Stripe Checkout Session，並回傳 `checkoutUrl`。

這是前端「支付顧問費用」按鈕呼叫的主要 API。

### Auth

需要登入。

```txt
Authorization: Bearer <supabase_access_token>
Idempotency-Key: <uuid>
```

同一使用者以相同 `Idempotency-Key` 與相同 payload 重送時，後端應恢復同一筆 checkout；同一使用者不得以相同 key 送出不同 payload。

### Request body

```ts
{
  method: 'online' | 'in-person'
  consultationDate: 'YYYY-MM-DD'
  timeSlot: 'am' | 'pm'
  designField?: string
  designFocus?: string
  sourceImageId?: string
  notes?: string
  paymentConsentAccepted: true
}
```

### Validation

| 欄位 | 規則 |
|---|---|
| `method` | 必填，僅允許 `online` / `in-person` |
| `consultationDate` | 必填，`YYYY-MM-DD` |
| `timeSlot` | 必填，僅允許 `am` / `pm` |
| `designField` | Optional，若提供需符合長度限制 |
| `designFocus` | Optional，若提供需符合長度限制 |
| `sourceImageId` | Optional |
| `notes` | Optional，需限制最大長度 |
| `paymentConsentAccepted` | 必須為 `true` |

Request body 不得包含 `amount`、`currency`、`paymentStatus`、`bookingStatus`、`consultantId`、Stripe price / product id。

### 後端流程

```txt
驗證 Supabase auth token
→ 取得 userId
→ 查詢 profile
→ 從 Auth / profile 產生 contact snapshot
→ 檢查 date + timeSlot 是否可預約
→ 後端再次執行 consultant match
→ 後端決定 price / currency / Stripe price id
→ 建立 ConsultationBooking: pending_payment
→ 建立 ConsultationPayment: pending
→ 建立 Stripe Checkout Session
→ 寫入 providerCheckoutSessionId
→ 回傳 checkoutUrl
```

### Response

```ts
{
  success: true,
  data: {
    bookingId: string
    paymentId: string
    checkoutUrl: string
    matchedConsultant: {
      id: string
      displayName: string
      title: string
      avatarUrl?: string
    }
  },
  error: null
}
```

### 常見錯誤

| 狀態碼 | Code | 情境 |
|---:|---|---|
| `400` | `VALIDATION_ERROR` | body 格式錯誤、unknown fields、未同意 payment consent |
| `401` | `UNAUTHORIZED` | 未登入或 token 無效 |
| `404` | `PROFILE_NOT_FOUND` | 找不到對應 profile |
| `409` | `SLOT_UNAVAILABLE` | 指定日期與時段不可預約 |
| `409` | `CONSULTANT_UNAVAILABLE` | 沒有 active consultant 可媒合 |
| `409` | `IDEMPOTENCY_KEY_CONFLICT` | 相同 key 搭配不同 payload |
| `500` | `CHECKOUT_CREATE_FAILED` | Stripe Checkout Session 建立失敗 |

### 注意事項

- `success_url` 不代表付款成功。
- `bookingStatus` / `paymentStatus` 不可由前端決定。
- `amount` / `currency` 不可由前端決定。
- `in-person` 落庫時正規化為 `in_person`。
- Checkout 前需要檢查時段可用性。
- DB partial unique index 仍是避免 double-booking 的最後防線。

---

## 6. `POST /api/v1/payments/stripe/webhook`

### 用途

接收 Stripe webhook，根據 Stripe 事件更新 payment / booking 狀態。

### Auth

不使用一般使用者 auth。此 route 透過 Stripe signature 驗證來源。

### Middleware 要求

Stripe webhook 必須使用 raw body，並掛在 `express.json()` 之前。

```txt
POST /api/v1/payments/stripe/webhook
→ raw body
→ verify Stripe signature
→ handle event
```

### 支援事件

目前主流程只處理：

```txt
checkout.session.completed
checkout.session.expired
```

後續可擴充事件：

```txt
payment_intent.payment_failed
charge.refunded
refund.updated
```

### 狀態流轉

```txt
checkout.session.completed
→ paymentStatus = paid
→ paidAt = now
→ bookingStatus = confirmed
```

```txt
checkout.session.expired
→ paymentStatus = canceled
→ canceledAt = now
→ bookingStatus = canceled
```

### Webhook 處理規則

| 步驟 | 規則 |
|---|---|
| 1 | 使用 raw body 與 `Stripe-Signature` 驗證 signature |
| 2 | 驗簽失敗時，不寫入 webhook event，不更新 booking / payment |
| 3 | 驗簽成功後，先寫入 `stripe_webhook_events.stripe_event_id` |
| 4 | 若 `stripe_event_id` 已存在且 `processed_at` 已存在，直接回 `200 OK` |
| 5 | 若 `stripe_event_id` 已存在但 `processed_at` 為 null，重新處理 event；處理失敗時回 `500`，讓 Stripe 以相同 event ID 重試 |
| 6 | 透過 `checkout.session.id` 查詢 `provider_checkout_session_id` |
| 7 | 找不到對應 payment 時，不建立未知 booking / payment，記錄 `processing_error` |
| 8 | 找到 payment 後，用 transaction 更新 payment、booking、webhook event |

### Response

Webhook 處理成功或 duplicate event 已處理時：

```ts
{
  received: true
}
```

### 常見錯誤

| 狀態碼 | Code | 情境 |
|---:|---|---|
| `400` | `INVALID_STRIPE_SIGNATURE` | Stripe signature 驗證失敗 |
| `200` | `DUPLICATE_EVENT_IGNORED` | 已處理過的 event，不重複更新 |
| `200` | `PAYMENT_NOT_FOUND` | 找不到本地 payment，已記錄錯誤但不建立未知資料 |
| `500` | `WEBHOOK_PROCESSING_FAILED` | 狀態同步失敗，event 不標記 processed；Stripe 重送相同 event ID 時會再次處理 |

### 注意事項

- Webhook 是付款狀態的主要真相來源。
- 前端 success page 只能提示「付款處理中」或重新查詢 booking 狀態。
- 同一筆 event 的 payment / booking / webhook event 更新必須 all-or-nothing。
- 退款補償流程不放在第一版 webhook 主流程。

---

## 7. `GET /api/v1/consultations/:bookingId`

### 用途

查詢單一預約詳情。前端在 `/consultant?payment=success` 或 `/consultant?payment=cancel` 後，可用此 API 查詢最新狀態。

### Auth

需要登入。

```txt
Authorization: Bearer <supabase_access_token>
```

### Path params

```txt
bookingId=<uuid>
```

### 權限

- 一般使用者只能查詢自己的 booking。
- `bookingId` 只代表查詢目標，不代表使用者有權限讀取。
- admin 查詢應另行設計 admin-only API。

### Response

```ts
{
  success: true,
  data: {
    booking: {
      id: string
      status: 'pending_payment' | 'confirmed' | 'payment_failed' | 'canceled' | 'completed'
      method: 'online' | 'in_person'
      consultationDate: string
      timeSlot: 'am' | 'pm'
      designField?: string
      designFocus?: string
      notes?: string
      contactName?: string
      contactEmail: string
      createdAt: string
      updatedAt: string
    }
    payment: {
      status: 'pending' | 'paid' | 'failed' | 'canceled' | 'refunded'
      amount: number
      currency: 'TWD'
      paidAt?: string
    }
    consultant?: {
      id: string
      displayName: string
      title: string
      avatarUrl?: string
    }
  },
  error: null
}
```

### 常見錯誤

| 狀態碼 | Code | 情境 |
|---:|---|---|
| `401` | `UNAUTHORIZED` | 未登入 |
| `403` | `FORBIDDEN` | booking 不屬於目前使用者 |
| `404` | `BOOKING_NOT_FOUND` | 找不到 booking |

---

## 8. `GET /api/v1/consultations/me`

### 用途

讓登入使用者查詢自己的預約紀錄，供「我的預約」頁面顯示日期時間軸、預約內容與完整預約列表。

### Auth

需要登入。

```txt
Authorization: Bearer <supabase_access_token>
```

### Query parameters

```txt
scope=all|upcoming
status=pending_payment|confirmed|payment_failed|canceled|completed
limit=20
cursor=...
```

- `scope` optional，預設 `all`。
- `scope=all` 可搭配 optional `status` 篩選。
- `scope=upcoming` 固定只查 `confirmed`，不接受 `status`；`scope=upcoming&status=confirmed` 與 `scope=upcoming&status=pending_payment` 都回傳 `400 VALIDATION_ERROR`。
- `scope=upcoming` 依 `Asia/Taipei` 判斷日期與 AM/PM 邊界：台北 12:00 前保留今天 AM/PM，12:00 起排除今天 AM、保留今天 PM；明天以後的 AM/PM 都保留。
- `status` optional，僅在 `scope=all` 時用於篩選 booking status；`scope=upcoming` 不接受。
- `limit` optional，預設 `20`，只接受 `1..50` 的整數。
- `cursor` optional，用於 cursor-based pagination；無法解碼或欄位不合法時回傳 `400 VALIDATION_ERROR`。
- query 使用 strict parsing；`scope`、`status`、`limit`、`cursor` 以外的 query parameter 回傳 `400 VALIDATION_ERROR`。

### 後端查詢條件

```txt
profileId = currentAuthProfile.id
```

- `profileId` 必須由 auth context 取得，不接受前端傳入。
- `scope=all` 時使用 optional `status`；`scope=upcoming` 時使用 `status = confirmed`，並排除台北當日已過的日期／AM 時段。
- 預設依 `consultationDate ASC`、`timeSlot ASC`、`id ASC` 排序；`id` 是相同日期與時段時的唯一 tie-breaker。
- cursor payload 包含 `version: 1`、`scope`、`scope=all` 時的 `status` filter、`consultationDate`、`timeSlot` 與 `id`；cursor 的 scope/status context 與目前 query 不一致時回傳 `400 VALIDATION_ERROR`。
- 為維持既有 `scope=all` 分頁相容性，沒有 `scope` 欄位的舊 version 1 cursor 會視為 `scope=all`；legacy cursor 不可用於 `scope=upcoming`。
- `timeSlot` 是 Prisma enum，repository 依 `am` / `pm` 明確展開 seek condition，不假設 enum 支援 `gt` / `lt` filter。
- 列表 endpoint 只回傳頁面需要的摘要欄位，不直接沿用單筆詳情 `ConsultationBookingDetail`。

### Response

```ts
{
  success: true,
  data: {
    items: [
      {
        id: string
        status:
          | 'pending_payment'
          | 'confirmed'
          | 'payment_failed'
          | 'canceled'
          | 'completed'
        method: 'online' | 'in_person'
        consultationDate: string // YYYY-MM-DD
        timeSlot: 'am' | 'pm'
        designField?: string
        designFocus?: string
        notes?: string
        consultant?: {
          displayName: string
          title: string
          avatarUrl?: string
        }
        createdAt: string // ISO 8601 datetime
      }
    ]
    nextCursor?: string
  },
  error: null
}
```

### 欄位說明

| 欄位 | 說明 |
|---|---|
| `id` | Booking ID。 |
| `status` | 預約狀態，由後端 consultation service 維護。 |
| `method` | 後端標準值，只回傳 `online` / `in_person`；前端負責轉成顯示文字。 |
| `consultationDate` | 預約日期，格式為 `YYYY-MM-DD`。 |
| `timeSlot` | 預約時段，只回傳 `am` / `pm`。 |
| `designField` | 設計領域；若 booking 未提供則省略。 |
| `designFocus` | 設計重點；若 booking 未提供則省略。 |
| `notes` | 使用者備註；未提供時省略。 |
| `consultant` | 已媒合顧問摘要；尚未媒合時省略。 |
| `createdAt` | Booking 建立時間，ISO 8601 datetime。 |
| `nextCursor` | 下一頁 cursor；沒有下一頁時省略。 |

### 常見錯誤

| 狀態碼 | Code | 情境 |
|---:|---|---|
| `400` | `VALIDATION_ERROR` | `scope` / `status` 組合、`limit` 或 `cursor` 格式錯誤 |
| `401` | `UNAUTHORIZED` | 未登入或 token 無效 |
| `404` | `PROFILE_NOT_FOUND` | 找不到對應 profile |

### 注意事項

- `GET /api/v1/consultations/me` 使用獨立列表 DTO，不直接定義為 `ConsultationBookingDetail[]`。
- 預設 `scope=all` 維持完整紀錄行為；前端「即將到來」頁面應明確使用 `scope=upcoming`。
- `scope=upcoming` 不包含 `pending_payment`、`payment_failed`、`canceled` 或 `completed`；日期或時段過期不會自動改寫 booking status。
- `method`、`status`、`timeSlot` 回傳後端 enum 原始值，不回傳 `Online`、`In-Person` 等 UI 顯示文字。
- Optional 欄位為 `null`、空字串或純空白時省略，不以空字串偽造資料；非空 `notes` 原始內容不由 mapper 改寫。
- 列表需要顧問摘要時由此 API 一次回傳，不應讓前端針對每筆 booking 再呼叫 `GET /api/v1/consultations/:bookingId`。
- `paymentStatus`、`amount`、`currency` 等付款資訊若目前列表 UI 不需要，第一版不回傳；需要時再明確擴充 contract，避免列表 response 持續膨脹。

---

## 9. `GET /api/v1/consultations/availability`

### 用途

查詢指定日期或整個月份的可預約時段，提供前端表單與月曆選擇 UX。

### Auth

建議需要登入。若未來需要公開展示可預約時段，再另行評估 public API。

### Query parameters

```txt
date=YYYY-MM-DD
```

或：

```txt
month=YYYY-MM
```

- `date` 與 `month` 二擇一，不可同時傳。
- `date` 用於單日查詢，保留既有設計。
- `month` 用於整月查詢，後端依 `YYYY-MM` 自行計算該月第一天與最後一天，不要求前端處理大小月或閏年。
- `month` 必須是有效月份，例如 `2026-07`；`2026-13` 應回傳 `400 VALIDATION_ERROR`。

### Response

單日查詢：

```ts
{
  success: true,
  data: {
    date: '2026-07-01'
    slots: [
      {
        timeSlot: 'am'
        available: true
      },
      {
        timeSlot: 'pm'
        available: false
      }
    ]
  },
  error: null
}
```

整月查詢：

```ts
{
  success: true,
  data: {
    month: '2026-07'
    startDate: '2026-07-01'
    endDate: '2026-07-31'
    days: [
      {
        date: '2026-07-01'
        slots: [
          {
            timeSlot: 'am'
            available: true
          },
          {
            timeSlot: 'pm'
            available: false
          }
        ]
      }
    ]
  },
  error: null
}
```

### 注意事項

- availability API 只作為 UX 提示。
- checkout API 仍必須再次檢查可用性。
- DB partial unique index 仍是避免 double-booking 的最後防線。
- 整月查詢應補齊該月所有日期；即使某天沒有已佔用時段，也應回傳該日的 `am` / `pm` 狀態。
- 整月查詢不新增 `startDate` / `endDate` 自訂區間，避免前端承擔大小月計算與不必要的查詢彈性。

### 必要測試

- `date=2026-07-01` 保留既有單日 response shape。
- `month=2026-07` 回傳 `2026-07-01` 到 `2026-07-31`。
- `month=2026-04` 回傳 `2026-04-01` 到 `2026-04-30`。
- `month=2028-02` 回傳 `2028-02-01` 到 `2028-02-29`。
- `month=2027-02` 回傳 `2027-02-01` 到 `2027-02-28`。
- `date` 與 `month` 同時傳應回傳 `400 VALIDATION_ERROR`。
- 未傳 `date` / `month`、無效日期、無效月份都應回傳 `400 VALIDATION_ERROR`。

---

## 10. `GET /api/v1/consultants/match`

### 用途

顧問諮詢頁載入時，顯示目前登入使用者的 matched consultant。實際 checkout 時，後端仍需重新媒合，避免前端顯示結果成為可信資料。

### Auth

需要登入。

```txt
Authorization: Bearer <supabase_access_token>
```

### Response

```ts
{
  success: true,
  data: {
    matchedConsultant: {
      id: string
      displayName: string
      title: string
      avatarUrl?: string
      bio?: string
    }
    matchReason: {
      source: 'style_dna_result' | 'fallback'
      matchedStyleGroup?: string
      matchedSpecialty?: string
    }
  },
  error: null
}
```

### 常見錯誤

| 狀態碼 | Code | 情境 |
|---:|---|---|
| `401` | `UNAUTHORIZED` | 未登入 |
| `404` | `PROFILE_NOT_FOUND` | 找不到 profile |
| `409` | `CONSULTANT_UNAVAILABLE` | 無 active consultant |

### 注意事項

- 前端不得把 `matchedConsultant.id` 放回 checkout payload。
- Checkout API 需要再次執行 consultant match。
- 顧問媒合只使用 `is_active = true` 的顧問。

---

## 11. `GET /api/v1/consultants`

### 用途

如果前端需要展示顧問卡片，才需要這支 API。若顧問資料只用於配對，不需要開 public API。

### Auth

可視產品設計決定：

- 顧問卡片公開展示：可允許 anon。
- 只在登入後展示：需要 authenticated。
- 只用於配對：不建立此 API，由 service 內部查詢。

### Response

```ts
{
  success: true,
  data: {
    items: [
      {
        id: string
        displayName: string
        title: string
        avatarUrl?: string
        bio?: string
        specialty?: string
      }
    ]
  },
  error: null
}
```

### 注意事項

- 只回傳 `is_active = true` 的顧問。
- 一般使用者不可新增、修改、刪除顧問。
- 停用顧問不可出現在前端清單。

---

## 12. 後續 API

### 12.1 `POST /api/v1/consultations/:bookingId/cancel`

用途：使用者取消尚未完成或尚未付款的預約。

第一階段建議只支援：

```txt
pending_payment → canceled
```

已付款後取消會牽涉退款，不建議混在第一版流程。

### 12.2 `POST /api/v1/payments/:paymentId/refund`

用途：建立退款。建議設計為 admin-only API。

未來需要定義：

```txt
退款原因
退款金額
是否全額退款
Stripe refund id
refund status
idempotency
bookingStatus 是否同步更新
錯誤原因記錄
```

---

## 13. 建議實作順序

```txt
1. 建立 auth middleware / getAuthContext
2. 實作 POST /api/v1/consultations/checkout
3. 實作 POST /api/v1/payments/stripe/webhook
4. 實作 GET /api/v1/consultations/:bookingId
5. 實作 GET /api/v1/consultations/me
6. 實作 GET /api/v1/consultations/availability
7. 視前端需求補 GET /api/v1/consultants/match
8. 視前端需求補 GET /api/v1/consultants
9. 未來再補 cancel / refund / admin API
```

---

## 14. 暫時不需要

第一版暫時不需要：

```txt
Redis
Queue worker
完整 admin 後台
完整 refund API
顧問 availability table
複雜顧問配對權重
微服務
CQRS
Kubernetes
```

等到出現跨 server rate limiting、非同步 webhook retry、背景任務、排班規則或高頻查詢瓶頸，再評估引入。
