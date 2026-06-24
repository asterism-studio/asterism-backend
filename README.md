# Asterism Backend

Asterism Backend 是 Asterism 的後端工作區，負責 **Express 基礎 API、Prisma Migration、資料匯入、圖片分析 pipeline**，並保留未來金流與 AI worker 的擴充位置。

目前架構方向是 **Supabase-first + Backend Worker Repo**：一般 app runtime 資料優先交給 Supabase + RLS，Backend Repo 只處理不適合放前端或 Supabase client 的工作。

---

## 架構分工

| 區塊 | 負責 |
|---|---|
| Frontend | UI、Pinia、service layer、呼叫 Supabase / backend API |
| Supabase | Auth、PostgreSQL、PostgREST、RLS、Storage |
| Backend Repo | migration、seed、CLIP pipeline、webhook、批次 worker |

```text
Frontend
→ Supabase Auth / Auto API / Storage / RLS
→ PostgreSQL

Backend Repo
→ Prisma Migration / seed / CLIP / webhook
→ PostgreSQL
```

---

## 目前 API

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/v1/health` | 健康檢查 |

成功回應：

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "asterism-backend"
  },
  "error": null
}
```

---

## 專案指令

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run start
```

資料庫相關：

```bash
npm run db:generate
npm run db:validate
npm run db:format
npm run db:migrate
```

圖片分析相關：

```bash
npm run enrich:images
npm run reclassify:submedium
npm run recompute:needs-review
```

---

## 環境變數

請在專案根目錄建立 `.env`。至少需要：

```env
NODE_ENV=development
PORT=3001
FRONTEND_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://user:password@localhost:5432/asterism
```

> `.env` 不應提交到 Git。

---

## 文件索引

| 文件 | 用途 |
|---|---|
| [docs/asterism-backend-architecture.md](docs/asterism-backend-architecture.md) | 後端目標架構、責任邊界、資料來源原則 |
| [docs/asterism-backend-flows.md](docs/asterism-backend-flows.md) | Auth、Style DNA、Moodboard、圖片、金流流程圖 |
| [docs/database-schema-draft.md](docs/database-schema-draft.md) | MVP database schema 草稿 |

---

## 開發原則

- 不直接提交 `.env` 或 secret。
- Schema 修改走 Prisma Migration。
- 一般 CRUD 優先走 Supabase Auto API + RLS。
- 需要 secret、webhook、批次或 AI pipeline 的流程才放 Backend Repo。
- 新增 API 時維持統一 response format。

---

## 外部規格

API contract:

```text
https://app.swaggerhub.com/apis-docs/asterism/asterism-api-contract/0.1.0
```
