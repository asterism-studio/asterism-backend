-- prisma/migrations/20260709000000_add_global_image_search/migration.sql

-- 以圖搜圖純檢索改版：全庫 kNN，不再按 styleGroup 篩選（open-set 拒絕改由前端對
-- top-1 相似度設門檻）。這是既有 search_images_by_embedding 拿掉 p_style_group 參數
-- 與 WHERE style_group 的版本，其餘篩選（已審 + 未排除 + 有 embedding）完全一致。
--
-- 依賴：images.embedding vector(512) + pgvector extension，來自先前 image-search 的
-- DB 變更（20260702_add_image_search_embeddings）。該變更已套用在 live DB，但不在 dev
-- 的 migration 歷史裡 —— 請比照上次那支 RPC 的方式套用（直接對 live DB，或連同 embedding
-- migration 一起帶進 dev）。舊 RPC search_images_by_embedding 先保留，前端切換部署完才退役。

CREATE OR REPLACE FUNCTION search_similar_images(
  query_embedding vector(512),
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
  WHERE images.excluded = false
    AND (images.needs_review->>'styleGroup')::boolean = false
    AND (images.needs_review->>'medium')::boolean = false
    AND (images.needs_review->>'subMedium')::boolean = false
    AND images.embedding IS NOT NULL
  ORDER BY images.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION search_similar_images(vector(512), int) TO anon, authenticated;
