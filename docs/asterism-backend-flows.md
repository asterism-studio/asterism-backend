# Asterism 後端功能流程規劃

> 本文件是「規劃中的功能流程圖」，不是目前 repo 已完整落地的真實架構。架構邊界與資料來源原則請見：[Asterism 後端架構規劃](./asterism-backend-architecture.md)
> 
> 文件版本：v1.0.0 | 最後更新日期：2026-06-24 

本文只描述：

- 核心功能流程
- Frontend / Supabase / Backend Repo 的互動方式
- 每個流程的職責分離

---

## 1. 核心功能流程總圖

```mermaid
flowchart TD
  User([User 使用者])

  subgraph FE[Frontend - Vue + Service Layer]
    AuthService[Auth Service]
    ProfileService[Profile Service]
    ImageService[Image Service]
    MoodboardService[Moodboard Service]
    PaymentService[Payment Service]
  end

  subgraph SB[Supabase]
    Auth[Auth]
    AutoApi[PostgREST Auto API]
    RLS[RLS]
    Profiles[(profiles)]
    Images[(images)]
    MoodboardFolders[(moodboard_folders)]
    MoodboardItems[(moodboard_items)]
    Payments[(payments / bookings)]
    DbLogic[Trigger / Function]
    Storage[(Storage)]
  end

  subgraph BE[Backend Worker Repo]
    Seed[Seed Import]
    Clip[CLIP Pipeline]
    CheckoutApi[Stripe Checkout API]
    Webhook[Stripe Webhook]
  end

  Stripe[Stripe]

  User --> AuthService
  AuthService --> Auth
  Auth --> DbLogic
  DbLogic --> Profiles
  User --> ProfileService
  ProfileService --> AutoApi
  AutoApi --> RLS
  RLS --> Profiles

  User --> ImageService
  ImageService --> AutoApi
  RLS --> Images
  Images --> Storage

  User --> MoodboardService
  MoodboardService --> AutoApi
  RLS --> MoodboardItems
  MoodboardItems --> Images
  MoodboardItems --> MoodboardFolders

  Seed --> Images
  Clip --> Storage
  Clip --> Images

  User --> PaymentService
  PaymentService --> CheckoutApi
  CheckoutApi --> Stripe
  Stripe --> Webhook
  Webhook --> Payments
```

---

## 2. 功能流程 A：註冊、驗證、登入、登出

### 2.1 流程圖

```mermaid
sequenceDiagram
  actor User as User
  participant Page as Vue Auth Page
  participant Service as Auth Service
  participant Client as supabase-js
  participant Auth as Supabase Auth
  participant Trigger as DB Trigger / Function
  participant Profiles as profiles

  rect rgb(245, 245, 245)
    note over User,Profiles: 註冊
    User->>Page: 填寫 email / password
    Page->>Service: signUp(payload)
    Service->>Client: supabase.auth.signUp()
    Client->>Auth: 建立 Auth user
    Auth->>Trigger: on user created
    Trigger->>Profiles: 建立 profile
    Auth-->>Client: session 或 email confirmation 狀態
    Client-->>Service: auth result
    Service-->>Page: 註冊結果
    Page-->>User: 導向 Style DNA 或提示驗證 email
  end

  rect rgb(245, 245, 245)
    note over User,Auth: 登入
    User->>Page: 輸入 email / password
    Page->>Service: signIn(payload)
    Service->>Client: supabase.auth.signInWithPassword()
    Client->>Auth: 驗證帳密
    Auth-->>Client: session / user
    Client-->>Service: session
    Service-->>Page: 更新登入狀態
  end

  rect rgb(245, 245, 245)
    note over User,Auth: 登出
    User->>Page: 點擊 Logout
    Page->>Service: signOut()
    Service->>Client: supabase.auth.signOut()
    Client->>Auth: 清除 session
    Auth-->>Client: success
    Client-->>Service: success
    Service-->>Page: 清空前端狀態
  end
```

### 2.2 職責分離

| 區塊 | 職責 |
|---|---|
| Frontend | 表單、錯誤顯示、導頁、前端 session 狀態 |
| Auth Service | 封裝 `supabase.auth.*`，不讓 UI 直接依賴 Supabase 細節 |
| Supabase Auth | 實際建立使用者、驗證帳密、管理 session |
| DB Trigger / Function | 註冊後初始化 profile |
| Backend Repo | 用 Prisma Migration 管理 trigger，不直接接管 Auth 流程 |

### 2.3 結論

登入 / 註冊 / 登出不需要自己寫 Express API。除非有特殊企業 SSO、客製安全策略或多系統同步需求，否則直接用 Supabase Auth。

---

## 3. 功能流程 B：Style DNA 測驗結果保存與重新讀取

### 3.1 流程圖

```mermaid
sequenceDiagram
  actor User as User
  participant Quiz as Style DNA Quiz Page
  participant Store as Style DNA Store
  participant Service as Profile Service
  participant Client as supabase-js
  participant Api as PostgREST Auto API
  participant RLS as RLS Policy
  participant Profiles as profiles

  rect rgb(245, 245, 245)
    note over User,Profiles: 測驗完成後保存
    User->>Quiz: 完成多輪圖片盲選
    Quiz->>Store: calculateStyleDnaResult()
    Store-->>Quiz: styleDnaResult
    Quiz->>Service: saveStyleDnaResult(result)
    Service->>Client: update profile
    Client->>Api: UPDATE profiles
    Api->>RLS: 檢查 auth.uid()
    RLS->>Profiles: 允許更新自己的 profile
    Profiles-->>Api: updated profile
    Api-->>Client: success
    Client-->>Service: success
    Service-->>Quiz: 保存成功
  end

  rect rgb(245, 245, 245)
    note over User,Profiles: 登出後重新登入並恢復結果
    User->>Quiz: 重新登入後進入首頁
    Quiz->>Service: getMyProfile()
    Service->>Client: select profile
    Client->>Api: SELECT profile by auth.uid()
    Api->>RLS: 只能讀自己的 profile
    RLS->>Profiles: 讀取 styleDnaResult
    Profiles-->>Api: profile
    Api-->>Client: profile
    Client-->>Service: styleDnaResult
    Service->>Store: restoreStyleDnaResult()
    Store-->>Quiz: 首頁 / 推薦可使用結果
  end
```

### 3.2 職責分離

| 區塊 | 職責 |
|---|---|
| Quiz Page | 控制測驗 UI 與流程 |
| Style DNA Store | 保存目前前端測驗狀態 |
| Profile Service | 封裝 profile 讀寫 |
| Supabase profiles | Style DNA 結果的正式資料來源 |
| RLS | 確保使用者只能讀寫自己的 profile |

### 3.3 單一資料來源

- 使用者完成測驗後，正式結果以 Supabase `profiles` 為準。
- Pinia 只是前端 runtime cache，不是永久資料來源。
- 登出後重新登入，前端應從 `profiles` 重新 hydrate 狀態。

---

## 4. 功能流程 C：Moodboard 收藏流程

### 4.1 流程圖

```mermaid
sequenceDiagram
  actor User as User
  participant Page as Image Detail / Home Page
  participant Service as Moodboard Service
  participant Client as supabase-js
  participant Auth as Supabase Auth
  participant Api as PostgREST Auto API
  participant RLS as RLS Policy
  participant Items as moodboard_items
  participant Images as images

  User->>Page: 點擊 Save / 收藏
  Page->>Service: saveImageToMoodboard(imageId, moodboardId?)
  Service->>Client: getSession()
  Client->>Auth: 取得目前 user session
  Auth-->>Client: user.id / access token

  alt 未登入
    Client-->>Service: no session
    Service-->>Page: 回傳需要登入
    Page-->>User: 顯示 Login / Sign up CTA
  else 已登入
    Service->>Client: insert moodboard_items
    Client->>Api: INSERT moodboard_items
    Api->>RLS: 檢查 auth.uid() 是否符合 folder owner
    RLS->>Items: 允許新增收藏
    Items->>Images: 關聯 image_id
    Items-->>Api: inserted item
    Api-->>Client: success
    Client-->>Service: success
    Service-->>Page: 更新 UI 狀態
    Page-->>User: 顯示 Saved / Toast
  end
```

### 4.2 職責分離

| 區塊 | 職責 |
|---|---|
| Page | 顯示收藏按鈕、Toast、登入 CTA |
| Moodboard Service | 封裝收藏流程與錯誤處理 |
| Supabase Auth | 判斷使用者是否登入 |
| RLS | 限制只能新增 / 讀取自己的收藏 |
| Backend Repo | 管理 Prisma Migration，不參與一般收藏 runtime API |

Moodboard 資料夾不要求在註冊時自動建立；可由使用者第一次收藏或建立收藏夾時，透過 Moodboard Service 寫入 `moodboard_folders`。

### 4.3 單一資料來源

- 收藏資料以 Supabase `moodboard_items` 為準。
- 前端的「已收藏」狀態只是 UI cache。
- 重新整理或重新登入後，應從 Supabase 重新查詢收藏狀態。

---

## 5. 功能流程 D：圖片抓取、匯入、顯示

### 5.1 流程圖

```mermaid
flowchart TD
  User([User])

  subgraph FE[Frontend]
    Page[Home / Image Pages]
    ImageService[Image Service]
    StyleJson[(style-data.json\nMVP fallback / seed source)]
  end

  subgraph SB[Supabase]
    Api[PostgREST Auto API]
    RLS[RLS Policy]
    Images[(images table\n正式 metadata source)]
    Storage[(Storage\nwebp files)]
  end

  subgraph BE[Backend Worker Repo]
    Prisma[Prisma Migration]
    Seed[Seed / Import Script]
    Clip[CLIP Pipeline]
  end

  External[External / Internal Image Sources]

  User --> Page
  Page --> ImageService

  ImageService --> Api
  Api --> RLS
  RLS --> Images
  Images --> Storage
  Images --> ImageService
  Storage --> ImageService
  ImageService --> Page
  Page --> User

  StyleJson -. fallback only .-> ImageService
  Prisma --> Images
  Seed --> StyleJson
  Seed --> Images
  External --> Storage
  Clip --> Storage
  Clip --> Images
```

### 5.2 建議資料流階段

| 階段 | 做法 |
|---|---|
| Phase 1 | 前端可繼續使用 `style-data.json`，確保 demo 穩定 |
| Phase 2 | Backend seed script 將 `style-data.json` 匯入 Supabase `images` table |
| Phase 3 | 前端 `image.service.ts` 改成優先讀 Supabase，失敗才 fallback JSON |
| Phase 4 | CLIP pipeline 補上 AI tags、embedding、confidence、review status |
| Phase 5 | 正式展示以 Supabase `images` table 為唯一主要來源 |

### 5.3 職責分離

| 區塊 | 職責 |
|---|---|
| Image Service | 統一封裝圖片查詢、fallback、排序策略 |
| Supabase images | 正式圖片 metadata source |
| Supabase Storage | 圖片檔案 source |
| Backend Seed | 把本機 JSON 匯入正式資料庫 |
| CLIP Pipeline | 批次分析圖片，寫入 AI 結果 |

### 5.4 單一資料來源

正式階段：

```text
圖片 metadata：Supabase images table
圖片檔案：Supabase Storage / public image path
AI 分析結果：Supabase images table
```

`style-data.json` 只能是：

- 初始 seed source
- demo fallback
- 本機開發備援

---

## 6. 功能流程 E：金流與顧問預約流程

> Future：此流程是後續金流規劃，建議不要阻塞目前 MVP。

### 6.1 流程圖

```mermaid
sequenceDiagram
  actor User as User
  participant Page as Vue Booking Page
  participant Service as Payment Service
  participant CheckoutApi as Backend Checkout API
  participant Stripe as Stripe
  participant Webhook as Backend Stripe Webhook
  participant DB as Supabase PostgreSQL
  participant RLS as Supabase RLS

  User->>Page: 選擇顧問 / 預約方案
  Page->>Service: createCheckoutSession(bookingDraft)
  Service->>CheckoutApi: POST /api/v1/checkout/session
  CheckoutApi->>DB: 建立 pending booking / payment
  CheckoutApi->>Stripe: create Checkout Session
  Stripe-->>CheckoutApi: checkoutUrl
  CheckoutApi-->>Service: checkoutUrl
  Service-->>Page: redirect URL
  Page-->>User: 導向 Stripe Checkout

  User->>Stripe: 完成付款
  Stripe->>Webhook: checkout.session.completed
  Webhook->>Stripe: 驗證 webhook signature
  Webhook->>DB: 更新 payment status = paid
  Webhook->>DB: 更新 booking status = confirmed

  User->>Page: 回到成功頁
  Page->>Service: getBookingStatus()
  Service->>DB: SELECT booking / payment
  DB->>RLS: 使用者只能讀自己的訂單
  RLS-->>DB: allow
  DB-->>Service: booking status
  Service-->>Page: confirmed
  Page-->>User: 顯示預約成功
```

### 6.2 職責分離

| 區塊 | 職責 |
|---|---|
| Frontend | 顯示方案、呼叫 checkout API、導向 Stripe、顯示結果 |
| Backend Checkout API | 使用 Stripe secret key 建立 checkout session |
| Stripe | 實際付款流程 |
| Backend Webhook | 驗證 webhook signature，更新付款狀態 |
| Supabase PostgreSQL | 保存 booking / payment 狀態 |
| RLS | 使用者只能查自己的訂單 |

### 6.3 金流結論

金流不應該是：

```text
Frontend → Supabase → 直接處理金流
```

推薦做法是：

```text
Frontend
→ Backend Checkout API
→ Stripe
→ Backend Webhook
→ Supabase PostgreSQL
→ Frontend 查詢付款 / 預約狀態
```

原因：

- Stripe secret key 不能放前端
- webhook 需要驗證 signature
- 付款成功後必須由可信任後端更新資料庫
- Supabase 可以存付款結果，但不應取代金流後端
