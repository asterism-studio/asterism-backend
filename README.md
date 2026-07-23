# Asterism Backend

Asterism 的 Node.js 後端，負責顧問預約、Stripe Checkout/Webhook、Supabase Auth token 驗證、Prisma schema/migrations，以及圖片分類與向量搜尋資料管線。

前端專案為 [asterism-studio/Asterism](https://github.com/asterism-studio/Asterism)，採 Vue 3、TypeScript、Vite、Pinia 與 Vue Router。

## 系統架構

```text
Asterism Frontend
├─ Supabase Auth / PostgREST / RLS ──> Supabase PostgreSQL
└─ Consultation API ────────────────> Express ──> Prisma ──> PostgreSQL
                                           └────> Stripe Checkout

Stripe ──webhook──> Express ──> consultation_payments / consultation_bookings
Image scripts ────> Pexels / Unsplash / CLIP ──> images / pgvector
```

| 區塊 | 技術與責任 |
|---|---|
| Frontend | Vue 3 UI、Pinia state、Vue Router；以 Supabase access token 呼叫後端 |
| Supabase | Auth、PostgreSQL、PostgREST、RLS、database functions |
| Express API | 預約可用時段、checkout、預約查詢、Stripe webhook |
| Prisma | 多檔 schema、migration、database constraints 與 RLS SQL |
| Image pipeline | Pexels/Unsplash 匯入、CLIP embeddings、分類與校準 |

一般 CRUD 優先走 Supabase + RLS；需要 Stripe secret、跨表交易、webhook 或批次運算的流程由此 repo 處理。

## 快速開始

需求：Node.js、npm，以及可連線的 PostgreSQL/Supabase database。

```bash
npm install
copy .env.example .env
npm run db:generate
npm run dev
```

Server 預設啟動於 `http://localhost:3001`。

## 環境變數

完整範例見 [.env.example](.env.example)。啟動 API 必填：

| 變數 | 用途 |
|---|---|
| `DATABASE_URL` | Prisma/PostgreSQL connection string |
| `SUPABASE_URL` | Supabase project URL，用於驗證 access token |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `STRIPE_SECRET_KEY` | Stripe server secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_CONSULTATION_PRICE_ID` | 諮詢訂金的 Stripe Price ID |
| `FRONTEND_ORIGIN` | Stripe success/cancel redirect 的單一前端 origin |
| `CORS_ORIGINS` | 允許呼叫 API 的 origins，以逗號分隔；未設定時沿用 `FRONTEND_ORIGIN` |

Production 的 `FRONTEND_ORIGIN` 不可包含逗號或使用 `localhost`。例如：

```env
FRONTEND_ORIGIN=https://asterism.pics
CORS_ORIGINS=https://asterism.pics,http://localhost:5173
```

`PEXELS_API_KEY` 與 `UNSPLASH_ACCESS_KEY` 只在執行圖片匯入管線時需要。不要提交 `.env` 或任何 secret。

## API

除 health check 與 Stripe webhook 外，consultation endpoints 都需要：

```http
Authorization: Bearer <Supabase access token>
```

| Method | Path | 說明 |
|---|---|---|
| `GET` | `/api/v1/health` | 健康檢查 |
| `POST` | `/api/v1/consultations/checkout` | 建立或恢復預約與 Stripe Checkout；另需 UUID `Idempotency-Key` header |
| `GET` | `/api/v1/consultations/availability?date=YYYY-MM-DD` | 查詢單日 AM/PM 可用時段 |
| `GET` | `/api/v1/consultations/availability?month=YYYY-MM` | 查詢整月可用時段 |
| `GET` | `/api/v1/consultations/me` | 查詢自己的預約；支援 `scope`、`status`、`limit`、`cursor` |
| `GET` | `/api/v1/consultations/:bookingId` | 查詢自己的單筆預約與付款狀態 |
| `POST` | `/api/v1/payments/stripe/webhook` | Stripe webhook；使用 raw body 驗證 signature |

API 回應統一使用：

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

## 常用指令

```bash
npm run dev
npm run typecheck
npm run build
npm run start

npm run db:generate
npm run db:validate
npm run db:format
npm run db:migrate

npm run enrich:images
npm run selfcheck:enrich
npm run backfill:embeddings
npm run reclassify:submedium
```

其他分類校準與資料收集腳本請查看 [package.json](package.json) 的 `scripts`。

目前測試使用 Node.js test runner 搭配 `tsx`：

```bash
npx tsx --test
```

## 專案結構

```text
src/
├─ config/          environment parsing and validation
├─ db/              Prisma client
├─ middleware/      auth、validation、error handling
└─ modules/
   ├─ consultation/ routes、schema、service、repository
   └─ payments/     Stripe checkout、webhook、repository
prisma/
├─ *.prisma         multi-file Prisma schema
└─ migrations/      schema、indexes、RLS、database functions
scripts/            image ingestion、embedding、classification、calibration
tests/              Node.js integration/unit tests
docs/               architecture、flows、schema 與 API 文件
```

## 開發原則

- Schema、RLS、index、trigger/function 修改一律走 Prisma migration，不在 Supabase Dashboard 手動維護。
- Route 負責 HTTP contract；service 負責商業規則；repository 負責 Prisma query。
- Request trust boundary 使用 Zod；認證使用 Supabase access token。
- Stripe 狀態只由可信任後端與已驗證的 webhook 更新。
- 使用 idempotency key、database constraints 與 transaction 保護 checkout 一致性。

## 文件

| 文件 | 用途 |
|---|---|
| [docs/asterism-api-list-v1.md](docs/asterism-api-list-v1.md) | API 清單 |
| [docs/asterism-backend-architecture.md](docs/asterism-backend-architecture.md) | 後端架構與責任邊界 |
| [docs/asterism-backend-flows.md](docs/asterism-backend-flows.md) | 功能流程圖 |
| [docs/consultation-schema.md](docs/consultation-schema.md) | Consultation schema、constraints 與 RLS |
| [docs/database/prisma-erd.svg](docs/database/prisma-erd.svg) | Prisma ERD |
