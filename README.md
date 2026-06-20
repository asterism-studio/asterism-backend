# Asterism Backend

Asterism Backend 是 Asterism 專案的後端 API 服務，負責處理使用者驗證、Moodboard 資料管理，以及未來的圖片推薦與 AI 模型相關功能。

---

## 環境需求

請先確認已安裝：

* Node.js
* npm

---

## 安裝專案

```bash
npm install
```

---

## 環境變數設定

請在專案根目錄建立 `.env` 檔案。

可以先複製範例檔：

```bash
cp .env.example .env
```

`.env` 內至少需要設定：

```env
NODE_ENV=development
PORT=3001
FRONTEND_ORIGIN=http://localhost:5173
```

> 注意：`.env` 不應提交到 Git。

---

## 啟動開發伺服器

```bash
npm run dev
```

啟動成功後，API server 會運行在：

```txt
http://localhost:3001
```

---

## 檢查服務狀態

可以使用以下 API 確認後端是否正常啟動：

```txt
GET /api/v1/health
```

範例：

```bash
curl http://localhost:3001/api/v1/health
```

成功時會回傳：

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

## 目前 API 範圍

目前已實作：

```txt
GET /api/v1/health
```

---

## 常用指令

```bash
# 啟動開發伺服器
npm run dev

# 檢查 TypeScript 型別
npm run typecheck

# 建立 production build
npm run build

# 執行 build 後的 server
npm run start
```

---

## API 回應格式

成功時：

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

失敗時：

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error message."
  }
}
```

---

## 開發注意事項

* 不要提交 `.env`
* 不要直接把資料庫帳號、JWT secret 等敏感資訊寫死在程式碼中
* 新增 API 時，請保持統一的 response 格式
* Request body 請先做資料驗證
* 新功能請從獨立分支開發，並透過 PR 合併

---

## 相關文件

API 規格請參考 Swagger 文件：

```txt
https://app.swaggerhub.com/apis-docs/asterism/asterism-api-contract/0.1.0
```
