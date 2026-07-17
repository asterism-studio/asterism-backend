import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { searchPexels } from './enrich/pexelsClient';
import { createClipEmbedder } from './enrich/clipEmbedder';

// Phase B（Open-set Recognition 負樣本）：抓一批「定義上就不可能是設計/服裝/
// 室內/建築美學參考圖」的純負樣本（狗、貓、食物、風景這類），只算 embedding
// 存成本機 JSON，用來校準 Acceptance Threshold（Phase C）。
// **不寫進 images 表**，跟 270 張人工標記的正樣本是完全獨立的資料集。
//
// 刻意不含 logo / icon / UI 截圖這種「Boundary Set」——那些可能本來就跟
// Graphic Design 重疊，混進來校準門檻會失真，另外開一個 Boundary Benchmark 測。
const PURE_NEGATIVE_QUERIES = [
  'dog',
  'cat',
  'bird',
  'person selfie',
  'fruit',
  'restaurant food',
  'car on highway',
  'mountain landscape',
  'beach sunset',
  'city street people'
];

const PER_QUERY = 10;

async function main(): Promise<void> {
  const embedder = await createClipEmbedder();
  const results: { query: string; url: string; embedding: number[] }[] = [];

  for (const query of PURE_NEGATIVE_QUERIES) {
    const photos = await searchPexels(query, PER_QUERY);
    for (const photo of photos) {
      const embedding = await embedder.embedImage(photo.url);
      results.push({ query, url: photo.url, embedding });
    }
    console.log(`${query}：抓了 ${photos.length} 張`);
  }

  const outPath = path.join(process.cwd(), 'scripts', 'negative-samples.json');
  fs.writeFileSync(outPath, JSON.stringify(results));
  console.log(`共 ${results.length} 張純負樣本，已寫入 ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
