# Database Schema Draft

> 草稿以目前 Prisma MVP schema 為準；欄位名稱使用實際資料庫 column name。

## profiles

放「auth.users 裝不下、或不該對外曝露」的使用者業務資料。`id` 預期對應 Supabase Auth user id，不另外建立 auth table。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| id | uuid | yes | Profile ID，對應 auth user id |
| username | varchar(32) | no | 使用者名稱，可作公開識別 |
| display_name | varchar(40) | no | 顯示名稱 |
| avatar_url | text | no | 頭像網址 |
| bio | varchar(160) | no | 自我介紹 |
| preferences | jsonb | no | 使用者偏好與業務設定 |
| style_dna_result | jsonb | no | 目前綁在使用者身上的 Style DNA 摘要資料 |
| onboarding_status | enum | yes | onboarding 狀態：not_started、dna_pending、completed |
| created_at | timestamptz | yes | 建立時間 |
| updated_at | timestamptz | yes | 更新時間 |

## images

圖片素材主表，保存探索與推薦會用到的圖片 metadata。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| id | text | yes | 圖片 ID，沿用匯入來源的穩定識別 |
| url | text | yes | 圖片網址 |
| title | text | yes | 圖片標題 |
| style_group | text | yes | 大風格分類 |
| style | text[] | no | 風格標籤 |
| medium | text | no | 媒材 |
| sub_medium | text | no | 子媒材 |
| color_palette | text[] | no | 色票或色彩標籤 |
| attribution | text | yes | 授權或 attribution 資訊 |
| confidence | jsonb | yes | 分類或標註信心分數 |
| needs_review | jsonb | yes | 待人工確認的欄位或原因 |
| created_at | timestamptz | yes | 建立時間 |
| excluded | boolean | yes | 是否排除於推薦或展示流程 |

## moodboard_folders

Moodboard 資料夾主表。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| id | uuid | yes | Moodboard folder ID |
| profile_id | uuid | yes | 擁有者 profile ID |
| name | varchar(40) | yes | 資料夾名稱 |
| description | varchar(160) | no | 資料夾描述 |
| cover_image_url | text | no | 封面圖片網址 |
| created_at | timestamptz | yes | 建立時間 |
| updated_at | timestamptz | yes | 更新時間 |

## moodboard_items

Moodboard 資料夾中的圖片項目。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| id | uuid | yes | Moodboard item ID |
| folder_id | uuid | yes | 所屬 moodboard folder ID |
| image_id | text | yes | 圖片 ID |
| note | varchar(300) | no | 使用者對此圖片的備註 |
| position | integer | yes | 資料夾內排序位置 |
| created_at | timestamptz | yes | 建立時間 |


