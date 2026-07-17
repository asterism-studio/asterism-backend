import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { searchPexels } from './enrich/pexelsClient';
import { createClipEmbedder } from './enrich/clipEmbedder';

// Domain Gate 專用評估集：跟 retrieval/styleGroup 用的資料集分開存，因為兩者回答
// 不同問題(「是不是設計圖」vs「像誰」),混在一起校準會失真(討論見
// docs/superpowers/specs/2026-07-09-image-search-pure-retrieval-design.md)。
//
// 正樣本兩路:
// 1. 圖庫全量(人工審核過的設計圖,embedding 已在 DB,零成本)——2026-07-15 起不再只用
//    labeled-test-set-270,圖庫本身就是最大的可信正樣本池。
// 2. 「圖庫外域內」正樣本:從 Pexels 抓「合法設計參考圖、但圖庫沒收的風格」(學院風等)。
//    只用圖庫當正樣本會讓校準看不到這種 miss——2026-07-15 學院風照 gate=0.246 被
//    T=0.25 誤擋就是這樣漏掉的。
// 負樣本:negative-samples.json 只取 6 類明確乾淨的(排除 mountain landscape /
// beach sunset / car on highway / city street people 這 4 類邊界案例——過去
// testBoundarySet.ts 也基於同樣理由排除它們),其餘類目從 Pexels 自動抓,不用人工挑。
//
// 用法:npx tsx scripts/collectGateEvalSet.ts
const CLEAN_NEGATIVE_CATEGORIES = ['dog', 'cat', 'bird', 'person selfie', 'fruit', 'restaurant food'];
const NEW_NEGATIVE_QUERIES = [
  'receipt paper',
  'excel spreadsheet screen',
  'invoice document',
  'office desk with laptop screen',
  'wildlife animal closeup',
  'soccer game action',
  'concert crowd stadium',
  'hospital medical equipment',
  'construction site machinery',
  'car engine repair',
  'gym workout fitness',
  'programming code on screen'
];
// 域內但圖庫大概率沒有的風格——正樣本要覆蓋「使用者會上傳的合法設計圖」全域,不是只覆蓋圖庫分佈。
const OUT_OF_LIBRARY_POSITIVE_QUERIES = [
  'preppy academia outfit',
  'school uniform fashion',
  'formal suit menswear fashion',
  'traditional kimono fashion',
  'bohemian style outfit',
  'industrial loft interior design',
  'gothic cathedral architecture',
  'vintage book cover design'
];
const PER_NEW_QUERY = 10;

interface GateEvalItem {
  id: string;
  embedding: number[];
  label: boolean; // true = 設計圖(domain positive), false = 離題(domain negative)
  source: string;
}

async function main(): Promise<void> {
  const negativeSamples: { query: string; url: string; embedding: number[] }[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'scripts', 'negative-samples.json'), 'utf-8')
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const items: GateEvalItem[] = [];

  try {
    const { rows } = await pool.query(
      `SELECT id, embedding::text AS embedding FROM images WHERE excluded = false AND embedding IS NOT NULL`
    );
    for (const row of rows) {
      items.push({ id: row.id, embedding: JSON.parse(row.embedding), label: true, source: 'library' });
    }
    console.log(`Domain positive(圖庫全量):${rows.length} 張`);

    const cleanNegatives = negativeSamples.filter((s) => CLEAN_NEGATIVE_CATEGORIES.includes(s.query));
    for (const s of cleanNegatives) {
      items.push({ id: s.url, embedding: s.embedding, label: false, source: `negative-samples:${s.query}` });
    }
    console.log(`Domain negative(既有乾淨類目):${cleanNegatives.length} 張`);

    const embedder = await createClipEmbedder();
    for (const query of NEW_NEGATIVE_QUERIES) {
      const photos = await searchPexels(query, PER_NEW_QUERY);
      for (const photo of photos) {
        const embedding = await embedder.embedImage(photo.url);
        items.push({ id: photo.url, embedding, label: false, source: `new-negative:${query}` });
      }
      console.log(`Domain negative(新抓):${query} 抓了 ${photos.length} 張`);
    }

    for (const query of OUT_OF_LIBRARY_POSITIVE_QUERIES) {
      const photos = await searchPexels(query, PER_NEW_QUERY);
      for (const photo of photos) {
        const embedding = await embedder.embedImage(photo.url);
        items.push({ id: photo.url, embedding, label: true, source: `out-of-library-positive:${query}` });
      }
      console.log(`Domain positive(圖庫外新抓):${query} 抓了 ${photos.length} 張`);
    }
  } finally {
    await pool.end();
  }

  const outDir = path.join(process.cwd(), 'evaluation', 'domain');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'gate-eval-set.json');
  fs.writeFileSync(outPath, JSON.stringify(items));

  const positiveCount = items.filter((i) => i.label).length;
  console.log(`\n共 ${items.length} 筆(正樣本 ${positiveCount}／負樣本 ${items.length - positiveCount}),已寫入 ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
