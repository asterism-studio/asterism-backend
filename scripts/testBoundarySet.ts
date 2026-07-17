import 'dotenv/config';
import { Pool } from 'pg';
import { searchPexels } from './enrich/pexelsClient';
import { createClipEmbedder } from './enrich/clipEmbedder';

// Boundary Set：logo / icon / app 截圖這類「不一定該拒絕」的邊界案例，跟
// Phase B 的純負樣本不一樣——沒有客觀對錯，這裡只是把現行系統（Text Anchor +
// T=0.22 Acceptance Threshold）實際會怎麼判定印出來，讓人工檢視合不合理。
// 只算 embedding、本機分類，**不寫資料庫**。
const BOUNDARY_QUERIES = [
  'logo design',
  'app icon design',
  'mobile app screenshot ui',
  'business card design',
  'book cover design'
];

const PER_QUERY = 6;
const ACCEPTANCE_THRESHOLD = 0.22; // 第九節 Youden Index 最佳值

interface AnchorRow {
  label: string;
  embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const anchorRes = await pool.query(
    `SELECT label, embedding::text AS embedding FROM classification_anchors WHERE dimension = 'styleGroup'`
  );
  await pool.end();
  const anchors: AnchorRow[] = anchorRes.rows.map((r) => ({ label: r.label, embedding: JSON.parse(r.embedding) }));

  const embedder = await createClipEmbedder();

  console.log('query | url | 判定 | Top1 styleGroup | score\n');
  for (const query of BOUNDARY_QUERIES) {
    const photos = await searchPexels(query, PER_QUERY);
    for (const photo of photos) {
      const embedding = await embedder.embedImage(photo.url);
      const ranked = anchors
        .map((a) => ({ label: a.label, score: cosineSimilarity(embedding, a.embedding) }))
        .sort((a, b) => b.score - a.score);
      const top1 = ranked[0];
      const decision = top1.score >= ACCEPTANCE_THRESHOLD ? `接受→${top1.label}` : '拒絕';
      console.log(`${query} | ${photo.url} | ${decision} | ${top1.label} | ${top1.score.toFixed(3)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
