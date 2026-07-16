-- prisma/migrations/20260716000100_add_search_limits_and_vector_index/migration.sql

-- 回應 PR #32 review（duyoushan1-stack）兩點意見：
-- 1. 以圖搜圖的兩支公開 RPC（anon key 就能打）沒有限制查詢筆數上限，match_count 直接拿去
--    當 LIMIT，理論上可以傳一個很大的數字把整張 images 表撈走。用 LEAST(match_count, 100)
--    夾住上限——前端最大只會拉 rerankCandidateCount=20 筆，100 留了足夠餘裕不影響正常使用。
-- 2. images.embedding 欄位做 <=> 相似度排序卻沒有向量索引，目前 2289 筆全表掃描還可以，
--    圖庫繼續擴充遲早會變慢。加 HNSW 索引（pgvector 0.8.0 / Postgres 17.6 皆支援，不需要
--    像 ivfflat 那樣先跑訓練，資料量小的現在建也不會太慢）。

CREATE INDEX IF NOT EXISTS "images_embedding_hnsw_idx"
ON "images" USING hnsw ("embedding" vector_cosine_ops);

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
  LIMIT LEAST(match_count, 100);
$$;

CREATE OR REPLACE FUNCTION search_similar_images(
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
  LIMIT LEAST(match_count, 100);
$$;
