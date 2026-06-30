# 顧問預約金流整合決策

> 日期：2026-06-26  
> 結論：本專案顧問預約金流主線建議使用 Stripe 官方 Node SDK，不採用 Supabase Stripe Wrapper 作為付款流程核心。
> 關聯技術規格：[顧問預約與金流技術規格設計書](./consultation-payment-technical-spec.md)

---

## 1. Stripe 與 Paddle 差異

| 面向              | Stripe                                                                                        | Paddle                                                                   | 本專案判斷                                    |
| ----------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| 產品定位          | 支付基礎建設，適合自訂 checkout、訂單、預約、退款、invoice、webhook                           | Merchant of Record 平台，偏 SaaS、訂閱、全球稅務與合規代管               | 顧問預約是 booking/order-first，Stripe 較直接 |
| API 串接          | Checkout Session / PaymentIntent / Customer / Invoice API 成熟，Node SDK 生態大               | API 也完整，但商品、價格、交易、訂閱模型較 Paddle 化                     | Stripe 和 Express 後端更貼合                  |
| Webhook           | 常用事件清楚，如 `checkout.session.completed`、`payment_intent.succeeded`、`invoice.paid`     | 常用事件如 `transaction.completed`、`transaction.paid`                   | 兩者都可用；Stripe 範例與社群資料更多         |
| Invoice / receipt | 可由 Dashboard 設定自動寄送 receipt、finalized invoice、paid invoice PDF，也可 API 建 invoice | Paddle 會寄送交易與訂閱相關 email，invoice 流程偏 sales-led/subscription | 若是單次顧問預約付款，Stripe 足夠             |
| 多國貨幣          | 支援 135+ presentment currencies，包含 TWD                                                    | 支援 30+ payment currencies，包含 TWD                                    | 兩者都符合                                    |
| TWD 注意事項      | TWD 可收款；payout 有特殊整數規則                                                             | 可用 TWD 收款；payout balance 幣別限 USD/EUR/GBP/AUD/CAD                 | 若重視台幣與銀行出金細節，Stripe 彈性較高     |
| Sandbox / 測試    | Test mode、test keys、test cards、Stripe CLI webhook forwarding                               | 獨立 sandbox account、test keys、test cards                              | 兩者都符合                                    |
| 稅務責任          | 預設商家自己負責；可另評估 Stripe Tax / Managed Payments                                      | Paddle 作為 Merchant of Record 是強項                                    | 若核心痛點是全球稅務代管，才改選 Paddle       |
| 前端整合          | Hosted Checkout 最省，成功後回前端查後端狀態                                                  | Paddle.js 也可做 checkout                                                | Stripe 最短路徑                               |

**結論：選 Stripe。**  
本專案目前需要的是「建立預約、付款、webhook 確認、更新預約狀態」，不是跨國 SaaS Merchant of Record 架構。Stripe 的 Checkout Session + webhook 剛好對上，而且可以把 `bookingId` 放在 `client_reference_id` 或 `metadata` 做後端對帳。

Paddle 適合等到這些條件成立再評估：

- 主要商品變成跨國 SaaS 訂閱。
- 想把 VAT/GST/sales tax 與銷售合規責任交給 Merchant of Record。
- 願意接受 Paddle 的商品、價格、交易模型成為金流主模型。

參考連結：

- [Stripe Checkout](https://docs.stripe.com/payments/checkout)
- [Stripe Checkout Session API](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe currencies](https://docs.stripe.com/currencies)
- [Stripe invoice emails](https://docs.stripe.com/invoicing/send-email)
- [Paddle supported currencies](https://developer.paddle.com/concepts/sell/supported-currencies/)
- [Paddle webhooks](https://developer.paddle.com/webhooks/)
- [Paddle invoices](https://developer.paddle.com/concepts/sell/sales-assisted-invoice/)
- [Paddle sandbox](https://developer.paddle.com/sdks/sandbox/)

---

## 2. 是否採用 Supabase Stripe Wrapper

**不建議把 Supabase Stripe Wrapper 放在主付款流程。**

Supabase 的 Stripe Wrapper 是 Postgres Foreign Data Wrapper (FDW)，核心用途是讓資料庫直接查詢 Stripe 的遠端資料。它可以把 Stripe 物件映射成資料庫的 foreign tables，例如 charges、checkout sessions、customers、invoices、payment intents。這對後台查帳或定期資料比對非常有用，但**並非**建立 Checkout Session、驗證 webhook、處理即時付款狀態轉移的最短路徑。

| 用法情境                                   | 建議做法                                             |
| ------------------------------------------ | ---------------------------------------------------- |
| 建立 Checkout Session                      | 使用後端 `stripe` Node SDK                           |
| 驗證 Stripe Webhook 簽章                   | 使用後端 `stripe.webhooks.constructEvent()`          |
| 更新 Booking/Payment 狀態                  | 後端 Webhook 直接寫入 Supabase PostgreSQL 實體資料表 |
| 後台查帳、對帳查詢 Stripe 物件             | 之後可考慮安裝 Supabase Stripe Wrapper 供分析使用    |
| 前端直接查詢 Stripe wrapper foreign tables | 不建議，金流資料不應直接暴露給前端客戶端             |

本專案目前採用 Supabase-first 架構，但有一條清楚的邊界：

```text
普通 CRUD / 使用者資料：Supabase Auth + Auto API + RLS
金流 Secret / Webhook / 狀態落庫：Express Backend (Backend Worker Repo)
```

因此最終決策採用：

```text
stripe Node SDK + Express webhook + Supabase PostgreSQL
```

不將 Supabase Stripe Wrapper 置入核心支付路徑，僅在未來管理後台有 SQL 級別對帳查詢需求時，再評估作為唯讀資料來源導入。

參考連結：

- [Supabase Stripe Wrapper](https://supabase.com/docs/guides/database/extensions/wrappers/stripe)

---

## 後續實作與詳細設計

關於詳細的前後端欄位對齊、Prisma Schema 定義、系統狀態機設計、時序圖流程以及落地的實作步驟，請參閱：
👉 **[顧問預約與金流技術規格設計書](./consultation-payment-technical-spec.md)**
