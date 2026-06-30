# Asterism 建議 API 清單 v1

> 版本：v1  
> 更新日期：2026-06-30  
> 適用範圍：顧問預約、Stripe 金流、顧問配對、預約查詢  
> 架構定位：Supabase-first + Backend Worker Repo

---

## 1. 設計原則

Asterism 目前已將顧問與金流 schema 上線至 Supabase。接下來 API 實作應優先處理：

1. 建立預約與 Stripe Checkout Session
2. 接收 Stripe webhook 並更新付款狀態
3. 查詢使用者自己的預約紀錄
4. 查詢指定日期的可預約時段
5. 在付款成功後由後端進行顧問配對

MVP 階段不建議一開始導入 Redis、完整 admin 後台、複雜排班系統、完整退款後台或微服務架構。先把金流、權限、狀態流轉守好。畢竟把系統做得又大又破，不會因為用了很多工具就比較有尊嚴。

---

## 2. Source of Truth

| 資料 | 真相來源 |
|---|---|
| `userId` | Supabase Auth session |
| `profileId` | 後端根據 `userId` 查詢 profiles |
| `email` | Supabase Auth / profiles |
| `contactEmail` | 後端從 Auth user email 產生快照 |
| `contactName` | 後端從 profiles 產生快照，MVP 可 nullable |
| `price` / `amount` | 後端 price config 或 Stripe price id |
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

如果前端 request body 出現這些欄位，後端應透過 Zod `.strict()` 拒絕 unknown fields，或在 service 層明確忽略並覆寫。

---

## 4. MVP 必做 API

## 4.1 `POST /api/v1/consultations/checkout`

### 用途

建立 consultation booking、建立 pending payment、建立 Stripe Checkout Session，並回傳 `checkoutUrl`。

這是前端「支付顧問費用」按鈕要呼叫的主要 API。

### Auth

需要登入。

後端必須從 Supabase Auth token 取得 `userId`，不得信任前端傳入的 user/profile 資訊。

### Request body

```ts
{
  method: 'online' | 'in_person'
  consultationDate: 'YYYY-MM-DD'
  timeSlot: 'am' | 'pm'
  designField: string
  designFocus: string
  sourceImageId?: string
  notes?: string
  paymentConsentAccepted: true
}
```

### Validation 建議

```ts
export const createCheckoutSchema = z.object({
  method: z.enum(['online', 'in_person']),
  consultationDate: z.string(),
  timeSlot: z.enum(['am', 'pm']),
  designField: z.string().min(1).max(80),
  designFocus: z.string().min(1).max(200),
  sourceImageId: z.string().optional(),
  notes: z.string().max(1000).optional(),
  paymentConsentAccepted: z.literal(true),
}).strict();
```

### 後端流程

```txt
驗證 Supabase auth token
→ 取得 userId
→ 查詢 profile
→ 從 Auth / profile 產生 contact snapshot
→ 檢查 date + timeSlot 是否可預約
→ 後端決定 price / currency / Stripe price id
→ 建立 ConsultationBooking: pending_payment
→ 建立 ConsultationPayment: pending
→ 建立 Stripe Checkout Session
→ 寫入 stripeSessionId
→ 回傳 checkoutUrl
```

### Response

```ts
{
  bookingId: string
  paymentId: string
  checkoutUrl: string
}
```

### 注意事項

- `success_url` 不代表付款成功。
- `bookingStatus` 不可由前端決定。
- `paymentStatus` 不可由前端決定。
- `amount` / `currency` 不可由前端決定。
- checkout 前需要檢查時段可用性。
- 若有 DB partial unique index，也仍應在 service 層做檢查與錯誤處理。

---

## 4.2 `POST /api/v1/payments/stripe/webhook`

### 用途

接收 Stripe webhook，根據 Stripe 事件更新 payment / booking 狀態。

### Auth

不使用一般使用者 auth。

此 route 透過 Stripe signature 驗證來源。

### Middleware 要求

Stripe webhook 必須使用 raw body，並掛在 `express.json()` 之前。

```ts
app.post(
  '/api/v1/payments/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler
);

app.use(express.json());
```

### 必須處理

- 使用 raw body
- 驗證 Stripe signature
- 記錄 Stripe event id
- 具備 idempotency
- 不重複處理同一個 event
- 不依賴 `success_url` 判斷付款成功

### MVP 建議處理事件

```txt
checkout.session.completed
checkout.session.expired
payment_intent.payment_failed
```

退款事件可以未來另開 issue：

```txt
charge.refunded
refund.updated
```

### 狀態流轉

```txt
checkout.session.completed
→ paymentStatus = paid
→ paidAt = now
→ bookingStatus = confirmed
→ consultant-match service 決定 consultantId
```

```txt
checkout.session.expired
→ paymentStatus = canceled
→ bookingStatus = canceled 或 pending_payment 保留，依規格決定
```

```txt
payment_intent.payment_failed
→ paymentStatus = failed
→ bookingStatus = payment_failed
```

### 注意事項

- webhook 是付款狀態的主要真相來源。
- 前端 success page 只能提示「付款處理中」或重新查詢 booking 狀態。
- 顧問配對應在付款成功後才執行。
- 顧問配對只應使用 `isActive = true` 的顧問。

---

## 4.3 `GET /api/v1/consultations/me`

### 用途

讓登入使用者查詢自己的預約紀錄。

### Auth

需要登入。

### Query parameters

```txt
status=pending_payment|confirmed|payment_failed|canceled|completed
limit=20
cursor=...
```

### 後端查詢條件

```ts
where: {
  profileId: authProfile.id
}
```

### Response

```ts
{
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
}
```

### 注意事項

- 不接受前端傳入 `profileId` 查詢。
- 一般使用者只能看到自己的 booking。
- admin 查詢應未來另開 admin-only API，不要混在這支。

---

## 4.4 `GET /api/v1/consultations/:bookingId`

### 用途

查詢單一預約詳情。

### Auth

需要登入。

### 權限

- 一般使用者只能查詢自己的 booking。
- admin 權限未來另開，不建議 MVP 混在同一流程。

### Response

```ts
{
  id: string
  method: string
  consultationDate: string
  timeSlot: string
  designField: string
  designFocus: string
  notes?: string
  bookingStatus: string
  paymentStatus: string
  contactName?: string
  contactEmail: string
  consultant?: {
    displayName: string
    title: string
    avatarUrl?: string
  }
  createdAt: string
  updatedAt: string
}
```

### 注意事項

- `bookingId` 只代表查詢目標，不代表使用者一定有權限讀取。
- repository 查出資料後，service 必須檢查 `profileId` 是否屬於目前登入使用者。

---

## 4.5 `GET /api/v1/consultations/availability?date=YYYY-MM-DD`

### 用途

查詢指定日期的可預約時段，提供前端表單選擇 UX。

### Auth

建議需要登入。

若首頁或公開頁需要展示可預約時段，未來可另評估是否開 public API。

### Query parameters

```txt
date=YYYY-MM-DD
```

### Response

```ts
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
```

### 注意事項

- availability API 只作為 UX 提示。
- checkout API 仍必須再次檢查可用性。
- DB 層若已設 partial unique index，仍要處理 conflict error。

---

## 5. 可做但非第一優先 API

## 5.1 `GET /api/v1/consultants`

### 用途

如果前端需要展示顧問卡片，才需要這支 API。

### Auth

可視產品設計決定：

- 若顧問卡片公開展示：可允許 anon
- 若只在登入後展示：需要 authenticated
- 若只用於配對：不需要做這支，改由後端 service 內部查詢

### 查詢條件

```ts
where: {
  isActive: true
}
```

### Response

```ts
{
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
}
```

### 注意事項

- 一般使用者不可新增、修改、刪除顧問。
- 停用顧問不可出現在前端清單。
- 若顧問資料只用於配對，不建議開 public API。

---

## 5.2 `POST /api/v1/consultations/:bookingId/cancel`

### 用途

使用者取消尚未完成或尚未付款的預約。

### Auth

需要登入。

### MVP 建議支援狀態

```txt
pending_payment → canceled
```

### Request body

```ts
{
  reason?: string
}
```

### 注意事項

- 已付款後取消會牽涉退款，不建議混在 MVP。
- 已付款取消應未來另接 refund policy。

---

## 5.3 `POST /api/v1/payments/:paymentId/refund`

### 用途

建立退款。

### 建議

MVP 暫時不做。

若未來要做，應是 admin-only API。

### 未來需要處理

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

## 6. 建議 module 拆法

```txt
src/modules/
  consultation/
    routes.ts
    schema.ts
    service.ts
    repository.ts
    types.ts

  payments/
    routes.ts
    stripeWebhook.routes.ts
    schema.ts
    service.ts
    repository.ts
    types.ts

  consultant-match/
    service.ts
    repository.ts
    types.ts

  consultants/
    routes.ts
    schema.ts
    service.ts
    repository.ts
    types.ts
```

---

## 7. 分層責任

| 檔案 | 責任 |
|---|---|
| `routes.ts` | 接 HTTP request、取得 auth context、呼叫 schema validation、呼叫 service |
| `schema.ts` | 驗證 body / query / params、拒絕 unknown fields、禁止 client 傳入敏感欄位 |
| `service.ts` | business logic、狀態流轉、付款流程、顧問配對流程 |
| `repository.ts` | 封裝 Prisma query，不放複雜 business logic |
| `types.ts` | module 內部共用型別 |
| `stripeWebhook.routes.ts` | 使用 raw body 處理 Stripe webhook |

---

## 8. 建議安裝套件

目前已規劃：

```bash
npm install stripe @supabase/supabase-js zod
```

建議 MVP 追加：

```bash
npm install helmet cors morgan dotenv express-rate-limit
npm install -D @types/cors @types/morgan
```

如果專案尚未安裝 Prisma：

```bash
npm install @prisma/client
npm install -D prisma
```

如果要提供 Swagger UI：

```bash
npm install swagger-ui-express
npm install -D @types/swagger-ui-express
```

如果未來想由 Zod schema 產生 OpenAPI：

```bash
npm install @asteasolutions/zod-to-openapi
```

---

## 9. 套件判斷

| 套件 | 是否需要 | 原因 |
|---|---:|---|
| `stripe` | 需要 | 建立 Checkout Session、處理 webhook |
| `@supabase/supabase-js` | 需要 | 驗證 Supabase Auth token、查 Auth user |
| `zod` | 需要 | API request validation |
| `helmet` | 需要 | 基本 HTTP security headers |
| `cors` | 需要 | 限制前端網域呼叫 API |
| `morgan` | 可用 | MVP request logging 夠用 |
| `dotenv` | 需要 | 本機讀取 env |
| `express-rate-limit` | 建議 | 限制 checkout / API 濫用 |
| `swagger-ui-express` | 可用 | 提供 `/api-docs` 文件展示 |
| `@asteasolutions/zod-to-openapi` | 未來可用 | 減少 Zod 與 OpenAPI 雙重維護 |
| `raw-body` | 不需要 | Express 內建 `express.raw()` 足夠 |
| `body-parser` | 不需要 | Express 內建 JSON parser 足夠 |
| `cookie-parser` | 暫時不需要 | 若使用 Bearer token，不需 cookie session |
| `jsonwebtoken` | 暫時不需要 | Supabase Auth 不建議自行手刻 JWT 驗證 |
| Redis | 暫時不需要 | MVP 尚無 queue / distributed lock / shared cache 需求 |

---

## 10. 建議實作順序

```txt
1. 建立 auth middleware / getAuthContext
2. 實作 POST /api/v1/consultations/checkout
3. 實作 POST /api/v1/payments/stripe/webhook
4. 實作 GET /api/v1/consultations/me
5. 實作 GET /api/v1/consultations/:bookingId
6. 實作 GET /api/v1/consultations/availability
7. 視前端需求補 GET /api/v1/consultants
8. 未來再補 cancel / refund / admin API
```

---

## 11. 測試重點

MVP 至少應測：

```txt
checkout API 拒絕 unknown fields
checkout API 不接受 amount / paymentStatus / consultantId
未登入不能 checkout
checkout 會建立 booking + payment + Stripe session
webhook 驗證 Stripe signature
重複 webhook event 不會重複處理
付款成功後 paymentStatus = paid
付款成功後 bookingStatus = confirmed
付款成功後才執行 consultant-match
使用者只能查自己的 booking
availability 回傳正確時段狀態
```

---

## 12. 暫時不需要

MVP 階段暫時不需要：

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

等到真的出現跨 server rate limiting、非同步 webhook retry、背景任務、排班規則或高頻查詢瓶頸，再討論這些工具。現在先把基本 API 做乾淨，對這個專案比較實際。
