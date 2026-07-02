-- prisma/migrations/20260702000000_add_image_search_embeddings/migration.sql

-- 以圖搜圖：pgvector extension、images 補 embedding 欄位、通用格式的分類錨點表、
-- 對外的相似度搜尋 RPC。前端 asterism repo 的 feat/image-search 分支已經照這個
-- RPC 契約寫死並測試過（mock），這裡照契約實作即可對齊。

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "images"
ADD COLUMN "embedding" vector(512);

CREATE TABLE "classification_anchors" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "dimension" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "embedding" vector(512) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "classification_anchors_dimension_label_key"
ON "classification_anchors"("dimension", "label");

ALTER TABLE "classification_anchors" ENABLE ROW LEVEL SECURITY;

-- 前端用 anon key 直接讀這張表算 styleGroup 分類；不開放公開寫入，
-- 只有跑批次腳本的 service role / owner 連線能寫（RLS 沒開寫入 policy 就是擋）。
CREATE POLICY "classification_anchors_public_read" ON "classification_anchors"
  FOR SELECT TO anon, authenticated
  USING (true);

-- 以圖搜圖的相似度查詢：SECURITY INVOKER（預設）讓呼叫者（anon）的權限套用，
-- 搭配 images_public_read 讓 RLS 正常生效。篩選條件比照 fetchImagesApi() 的
-- 公開讀取 gate（excluded=false + needs_review 三欄皆已審），避免回傳前端本地
-- 快取查不到的未審核/已排除圖片。
CREATE OR REPLACE FUNCTION search_images_by_embedding(
  query_embedding vector(512),
  p_style_group text,
  match_count int DEFAULT 4
)
RETURNS TABLE (
  id text,
  url text,
  title text,
  style_group text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    images.id,
    images.url,
    images.title,
    images.style_group,
    1 - (images.embedding <=> query_embedding) AS similarity
  FROM images
  WHERE images.style_group = p_style_group
    AND images.excluded = false
    AND (images.needs_review->>'styleGroup')::boolean = false
    AND (images.needs_review->>'medium')::boolean = false
    AND (images.needs_review->>'subMedium')::boolean = false
    AND images.embedding IS NOT NULL
  ORDER BY images.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION search_images_by_embedding(vector(512), text, int) TO anon, authenticated;
