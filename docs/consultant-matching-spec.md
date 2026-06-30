# 顧問媒合邏輯技術規格

> 更新日期：2026-06-28  
> 狀態：Planned  
> 版本：v1 - 從顧問預約與金流規格拆分  
> 關聯文件：
> - 顧問預約與金流技術規格設計書：[consultation-payment-technical-spec.md](./consultation-payment-technical-spec.md)

本文件定義 Asterism 顧問媒合的 MVP 判斷邏輯。顧問預約與付款流程只引用本文件，不在金流規格書內重複維護媒合細節。

---

## 1. 設計目標

顧問媒合用於在使用者進入顧問諮詢頁與建立 checkout booking 前，根據使用者的 Style DNA 結果，回傳一位可預約的 active consultant。

MVP 階段採用 rule-based matching，不實作完整推薦演算法、顧問排班或負載分配。

媒合功能實作於 `src/modules/consultants/`。`consultant.routes.ts` 負責宣告 endpoint、串接 auth middleware，並以薄 route handler 呼叫 `consultant-match.service.ts`；MVP 不另外建立 controller。Prisma schema 只負責 consultant 資料結構與資料庫約束，不承擔 HTTP request validation。

---

## 2. 判斷來源

後端從登入使用者的 `profiles.style_dna_result` 取得主要風格結果，例如：

- `primaryStyleGroup`
- `topStyleGroups[0]`
- 或目前資料結構中代表主要風格的欄位

若使用者尚未完成 Style DNA，則使用 fallback consultant。

---

## 3. Mapping 規則

| Style Group | Consultant Specialty |
|---|---|
| Minimal / Modern / Scandinavian | `spatial` |
| Vintage / Romantic / Art Deco | `visual_styling` |
| Industrial / Brutalist / Futuristic | `concept_design` |

`consultants.specialty` 使用 Prisma enum `ConsultantSpecialty`，目前合法值只有 `spatial`、`visual_styling`、`concept_design`。Fallback consultant 可以沒有 specialty；active consultant 若要參與特定分類媒合，必須填入上述 enum key。

> 實際 style group key 需以專案現有 Style DNA 結果格式為準。若目前尚未定義正式 key，先在 `consultant-match.service.ts` 中集中管理 mapping，避免散落在 component 或 route handler。

---

## 4. Match 流程

1. `requireAuth` middleware 驗證 Supabase Access Token，並提供可信任的 `profile_id`。
2. 讀取使用者 profile 與 `style_dna_result`。
3. 取得主要 style group。
4. 透過 mapping 找出 consultant specialty。
5. 查詢 `is_active = true` 且 specialty 符合的 consultant。
6. 若無符合 specialty 的顧問，fallback 為第一位 `is_active = true` 的 consultant。
7. 若無任何 active consultant，回傳 `409 CONSULTANT_UNAVAILABLE`，不得建立 booking / checkout。

---

## 5. API 使用位置

此媒合邏輯會被兩個後端流程使用：

| 使用位置 | 說明 |
|---|---|
| `GET /api/v1/consultants/match` | 顧問諮詢頁載入時，回傳目前使用者的 matched consultant |
| `POST /api/v1/consultations/checkout` | 建立 booking 前再次媒合 active consultant，並寫入 `consultation_bookings.consultant_id` |

前端不得在 checkout payload 中傳入 `consultantId`、`consultantName` 或 `consultantTitle`。前端只顯示媒合結果，不作為可信資料來源。

共用 middleware 只處理跨 endpoint 的 HTTP concerns，例如 authentication、request validation 與錯誤傳遞。選擇哪個媒合流程、查詢哪些資料及如何 fallback 屬於 endpoint-specific business flow，由 route handler 呼叫 `consultant-match.service.ts` 完成，不放入 middleware。

---

## 6. MVP 不做項目

以下項目不納入本版媒合邏輯：

- 9 大 style group 對 9 位顧問的完整配置。
- 顧問排班系統。
- 顧問可預約時段管理。
- 顧問負載平均分配。
- AI-based consultant matching。
- 尚未預約時保存長期 `ConsultantMatch` 紀錄。
- 管理後台編輯 consultant。

若未來需要在「尚未建立 booking」前長期保存媒合結果，才另外新增 `ConsultantMatch` model。
