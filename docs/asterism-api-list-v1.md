# 顧問預約與金流 API Contract

> 更新日期：2026-07-02  
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
| `GET /api/v1/consultations/availability` | 建議 | Required | 查詢指定日期可預約時段 |
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
| 5 | 若 `stripe_event_id` 已存在但 `processed_at` 為 null，不重複更新 booking / payment |
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
| `500` | `WEBHOOK_PROCESSING_FAILED` | 狀態同步失敗，event 不標記 processed |

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

讓登入使用者查詢自己的預約紀錄。

### Auth

需要登入。

```txt
Authorization: Bearer <supabase_access_token>
```

### Query parameters

```txt
status=pending_payment|confirmed|payment_failed|canceled|completed
limit=20
cursor=...
```

### 後端查詢條件

```txt
profileId = currentAuthProfile.id
```

不接受前端傳入 `profileId` 查詢。

### Response

```ts
{
  success: true,
  data: {
    items: [
      {
        id: string
        method: string
        consultationDate: string
        timeSlot: string
        bookingStatus: string
        paymentStatus: string
        consultant?: {
          displayName: string
          title: string
          avatarUrl?: string
        }
        createdAt: string
      }
    ]
    nextCursor?: string
  },
  error: null
}
```

---

## 9. `GET /api/v1/consultations/availability`

### 用途

查詢指定日期的可預約時段，提供前端表單選擇 UX。

### Auth

建議需要登入。若未來需要公開展示可預約時段，再另行評估 public API。

### Query parameters

```txt
date=YYYY-MM-DD
```

### Response

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

### 注意事項

- availability API 只作為 UX 提示。
- checkout API 仍必須再次檢查可用性。
- DB partial unique index 仍是避免 double-booking 的最後防線。

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