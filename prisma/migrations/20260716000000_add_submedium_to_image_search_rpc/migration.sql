-- prisma/migrations/20260716000000_add_submedium_to_image_search_rpc/migration.sql

-- 以圖搜圖結果卡片要顯示 subMedium 標籤（前端 asterism repo feat/image-search 已接好），
-- search_similar_images 目前只回 style_group，缺 sub_medium，補進 RETURNS TABLE/SELECT。
-- Postgres 不允許用 CREATE OR REPLACE 改變既有函式的回傳欄位結構（OUT 參數的 row type
-- 不同），要先 DROP 再重建；輸入參數簽名不變，對既有呼叫端相容。

DROP FUNCTION IF EXISTS search_similar_images(vector(512), int);

CREATE FUNCTION search_similar_images(
  query_embedding vector(512),
  match_count int DEFAULT 4
)
RETURNS TABLE (
  id text,
  url text,
  title text,
  style_group text,
  sub_medium text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    images.id,
    images.url,
    images.title,
    images.style_group,
    images.sub_medium,
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
