# `GET /api/v1/consultations/me` Upcoming 實作規格

> 文件類型：已實作規格
> 更新日期：2026-07-13
> 對應後端 PR：`asterism-studio/asterism-backend#44`

本文件描述目前已實作的 `GET /api/v1/consultations/me` 行為。所有規則以後端 runtime、schema、repository 與測試為準。

## 1. Endpoint

```http
GET /api/v1/consultations/me
```

用途：讓已登入使用者查詢自己的 consultation bookings，支援完整列表與即將到來列表。

認證：

```http
Authorization: Bearer <supabase_access_token>
```

後端先由 auth context 取得 user ID，再查詢該使用者的 profile。`profileId` 不接受前端傳入。

## 2. Query Contract

Query 使用 strict parsing。支援兩種互斥模式：

| 模式 | `scope` | `status` | 預設行為 |
|---|---|---|---|
| 完整列表 | `all` | Optional | `scope` 未提供時使用此模式 |
| 即將到來 | `upcoming` | 不允許 | 固定只查 `confirmed` |

欄位規則：

| 欄位 | 規則 |
|---|---|
| `scope` | `all` 或 `upcoming`；省略時為 `all` |
| `status` | 只有 `scope=all` 可提供；允許 `pending_payment`、`confirmed`、`payment_failed`、`canceled`、`completed` |
| `limit` | Optional，預設 `20`，整數範圍 `1..50` |
| `cursor` | Optional，非空 opaque cursor 字串 |
| 其他 query 欄位 | 拒絕並回傳 `400 VALIDATION_ERROR` |

合法範例：

```http
GET /api/v1/consultations/me
GET /api/v1/consultations/me?scope=all&status=confirmed&limit=20
GET /api/v1/consultations/me?scope=upcoming&limit=5
GET /api/v1/consultations/me?scope=upcoming&limit=5&cursor=<nextCursor>
```

以下 request 會回傳 `400 VALIDATION_ERROR`：

```http
GET /api/v1/consultations/me?scope=upcoming&status=confirmed
GET /api/v1/consultations/me?scope=upcoming&status=pending_payment
GET /api/v1/consultations/me?scope=unknown
GET /api/v1/consultations/me?unexpected=value
```

`scope=upcoming` 本身代表固定套用 `status = confirmed`，不需要也不允許再傳 `status`。

## 3. Scope Semantics

### 3.1 `scope=all`

查詢條件為：

```txt
profileId = authenticated user's profile ID
AND optional status filter
```

省略 `status` 時，完整列表可包含所有合法 booking status，包括 `pending_payment`、`confirmed`、`payment_failed`、`canceled` 與 `completed`。

### 3.2 `scope=upcoming`

查詢條件為：

```txt
profileId = authenticated user's profile ID
AND status = 'confirmed'
AND (
  consultationDate > Taipei today
  OR (
    consultationDate = Taipei today
    AND timeSlot IN Taipei today's allowed slots
  )
)
```

`pending_payment` 暫不屬於 upcoming。它代表付款尚未完成的 checkout draft，不是已成立的預約。

Upcoming status 行為：

| Status | 是否回傳 | 說明 |
|---|---:|---|
| `pending_payment` | 否 | 尚未完成付款 |
| `confirmed` | 是 | 付款完成且預約已成立 |
| `payment_failed` | 否 | 付款失敗 |
| `canceled` | 否 | 預約已取消 |
| `completed` | 否 | 服務已完成 |

## 4. Taipei Date and AM/PM Boundary

`consultationDate` 在資料庫中是 PostgreSQL `date`，`timeSlot` 是 `am` / `pm` enum。系統目前沒有每個預約的實際開始或結束 datetime，因此 upcoming 使用以下固定的台北本地時間邊界：

| 台北本地時間 | 今天的 `AM` | 今天的 `PM` | 明天以後的 `AM` / `PM` |
|---|---:|---:|---:|
| `00:00`–`11:59` | 回傳 | 回傳 | 回傳 |
| `12:00` 起 | 排除 | 回傳 | 回傳 |

換句話說：

- 台北 12:00 前，今天的 AM 與 PM 都屬於 upcoming。
- 台北 12:00 起，今天的 AM 不再屬於 upcoming，今天的 PM 仍屬於 upcoming。
- 系統只能依現有 AM/PM 粒度排除今天的 AM，不能判斷 PM 內部的實際開始或結束時間。

## 5. Time Resolution

Upcoming 的 service dependency 注入：

```ts
now(): Date
```

實際查詢 `scope=upcoming` 資料時，service 會呼叫一次 `now()`，並將時間轉換為 `Asia/Taipei` 的：

```ts
{
  today: string
  todayTimeSlots: ['am', 'pm'] | ['pm']
}
```

轉換規則：

- 台北 hour `< 12`：`todayTimeSlots = ['am', 'pm']`
- 台北 hour `>= 12`：`todayTimeSlots = ['pm']`

Repository 只接收已解析的日期與時段條件，不自行呼叫 `new Date()`，也不依賴資料庫或執行環境的本地時區。

此查詢不會：

- 將 `today` 寫入資料庫
- 在讀取時修改 booking status
- 建立 cron job 更新過期預約
- 讓前端傳入日期或時間邊界

## 6. Repository Query

Owner scope 永遠保留：

```ts
profileId: authenticatedProfile.id
```

Upcoming 的 Prisma where 條件等價於：

```ts
{
  profileId,
  status: 'confirmed',
  OR: [
    { consultationDate: { gt: today } },
    {
      consultationDate: today,
      timeSlot: { in: todayTimeSlots }
    }
  ]
}
```

所有列表維持相同排序：

```ts
[
  { consultationDate: 'asc' },
  { timeSlot: 'asc' },
  { id: 'asc' }
]
```

`timeSlot` 的 AM/PM seek 條件由 repository 明確展開，不依賴 enum 的大小比較。

目前使用既有 owner/date/slot/id composite index：

```prisma
@@index(
  [profileId, consultationDate, timeSlot, id],
  map: "consultation_bookings_profile_date_slot_id_idx"
)
```

本功能不新增 Prisma model、migration 或額外 index。

## 7. Cursor Contract

Cursor 是 opaque 的 base64url JSON 字串，前端只需原樣保存與回傳，不解析內容。

新產生的 cursor version 1 payload：

```ts
{
  version: 1,
  scope: 'all' | 'upcoming',
  status?: BookingStatus,
  consultationDate: 'YYYY-MM-DD',
  timeSlot: 'am' | 'pm',
  id: string
}
```

欄位限制：

- `scope=all` cursor 可以包含 `status`，其值必須與目前 query 相同。
- `scope=all` 未使用 status filter 時，cursor 不包含 `status`。
- `scope=upcoming` cursor 不包含 `status`；scope policy 已固定為 `confirmed`。
- cursor 的 `scope` 與目前 query 不一致時回傳 `400 VALIDATION_ERROR`。
- malformed、版本錯誤、日期錯誤、UUID 錯誤或 status context 不一致時回傳 `400 VALIDATION_ERROR`。

### 7.1 Legacy Cursor Compatibility

既有 version 1 cursor 可能沒有 `scope` 欄位。為維持既有完整列表的 cursor pagination：

- 沒有 `scope` 的舊 cursor 會被 decoder 視為 `scope=all`。
- 舊 cursor 可以繼續用於 `scope=all`。
- 舊 cursor 不可用於 `scope=upcoming`。
- 新產生的 cursor 一律包含 `scope`。

每次 request 都重新依當下台北日期與 12:00 時段邊界查詢；跨過午夜或 12:00 載入下一頁時，查詢邊界可能改變。目前 cursor 不保存時間 snapshot。

## 8. Response Contract

成功 response 使用標準 envelope：

```ts
{
  success: true,
  data: {
    items: [
      {
        id: string,
        status:
          | 'pending_payment'
          | 'confirmed'
          | 'payment_failed'
          | 'canceled'
          | 'completed',
        method: 'online' | 'in_person',
        consultationDate: 'YYYY-MM-DD',
        timeSlot: 'am' | 'pm',
        designField?: string,
        designFocus?: string,
        notes?: string,
        consultant?: {
          displayName: string,
          title: string,
          avatarUrl?: string
        },
        createdAt: string
      }
    ],
    nextCursor?: string
  },
  error: null
}
```

Response rules：

- `consultationDate` 維持 `YYYY-MM-DD`。
- `createdAt` 為 ISO 8601 datetime。
- `consultant` 只有存在顧問摘要時回傳。
- `designField`、`designFocus`、`notes`、`avatarUrl` 為 null、空字串或純空白時省略。
- 非空 `notes` 的原始內容不由 mapper 改寫。
- 沒有下一頁時省略 `nextCursor`。

## 9. Status Lifecycle Boundary

日期或時段過期只會影響 booking 是否出現在 `scope=upcoming`，不會自動改寫 booking status。

目前已過期但仍為 `confirmed` 的 booking：

- 不出現在 upcoming。
- 保留 `confirmed` 狀態。
- 保留給 history、admin、no-show 或人工流程處理。

`confirmed -> completed` 代表服務完成，需由完成確認流程觸發；`confirmed -> canceled` 代表取消／退款流程完成，需由相應流程觸發。目前這兩種轉換不屬於本 endpoint 的查詢副作用。

## 10. Security and Consumer Rules

- endpoint 必須通過 auth middleware。
- repository 查詢永遠使用 authenticated profile scope。
- 前端不可傳入 `profileId`、`today` 或時段邊界。
- 前端不可抓 `scope=all` 後自行 filter upcoming。
- 前端不可用 client timezone 或 client date 判斷 upcoming。
- 前端不可將 `completed`、`canceled` 從局部頁面 filter 後假裝取得完整 upcoming。
- `method`、`status`、`timeSlot` 回傳 backend enum 原始值，不轉換為 UI 顯示文字。

## 11. Error Contract

| HTTP status | Error code | 條件 |
|---:|---|---|
| `400` | `VALIDATION_ERROR` | query、scope/status 組合或 cursor 無效 |
| `401` | `UNAUTHORIZED` | 未登入或 token 無效 |
| `404` | `PROFILE_NOT_FOUND` | authenticated user 沒有對應 profile |

## 12. Implemented Verification

目前測試覆蓋以下已實作行為：

- `scope` 預設為 `all`，`scope=all` 與 `scope=upcoming` 可解析。
- `scope=upcoming` 拒絕任何 `status` query。
- unknown scope、unknown query parameter、invalid limit 會被拒絕。
- cursor 必須符合 scope/status context；legacy version 1 cursor 可相容於 `scope=all`。
- service 依 Asia/Taipei 11:59 與 12:00 邊界產生正確的 `todayTimeSlots`，每個 upcoming request 只讀取一次 now。
- repository 保留 owner scope，並產生 `confirmed`、日期、AM/PM 的 upcoming where。
- today 以前、pending payment、completed、canceled 與 payment failed 不會進入 upcoming。
- route 維持 auth gate、strict query validation 與標準 response envelope。
