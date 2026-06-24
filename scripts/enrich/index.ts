import 'dotenv/config';
import { Pool } from 'pg';
import { STYLE_GROUP_ANCHORS } from './taxonomy';
import { classifyImage } from './classify';
import { buildImageRow } from './buildImageRow';
import type { ImageRow } from './buildImageRow';
import { createClipScorer } from './clipScorer';
import { extractPalette } from './colorPalette';
import { searchPexels } from './pexelsClient';
import { searchUnsplash } from './unsplashClient';
import { insertImageRows } from './dbWriter';

const IMAGES_PER_SOURCE = 15; // 15 Pexels + 15 Unsplash = 30 張/組，9 組 = 270 張

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // try/finally 確保中途拋錯時 pool 仍會關閉，避免連線洩漏。
  try {
    const scorer = await createClipScorer();
    const allRows: ImageRow[] = [];
    let skipped = 0;

    for (const [styleGroup, anchorPrompt] of Object.entries(STYLE_GROUP_ANCHORS)) {
      const [pexelsResults, unsplashResults] = await Promise.all([
        searchPexels(anchorPrompt, IMAGES_PER_SOURCE),
        searchUnsplash(anchorPrompt, IMAGES_PER_SOURCE)
      ]);

      const groupRows: ImageRow[] = [];
      for (const meta of [...pexelsResults, ...unsplashResults]) {
        // 單張失敗（抓不到圖／取色失敗／CLIP 無法處理）只跳過該張，不拖累整批。
        try {
          const classification = await classifyImage(scorer, meta.url);
          const palette = await extractPalette(meta.url);
          groupRows.push(buildImageRow(classification, palette, meta));
        } catch (error) {
          skipped += 1;
          console.warn(`[${styleGroup}] 跳過 ${meta.url}：`, (error as Error).message);
        }
      }

      // 每組各寫一次：後面的組失敗，前面已處理的組仍已入庫（insertImageRows 為 ON CONFLICT DO NOTHING，可重跑）。
      await insertImageRows(pool, groupRows);
      allRows.push(...groupRows);
      console.log(`[${styleGroup}] 入庫 ${groupRows.length} 張`);
    }

    const distribution = allRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.style_group] = (acc[row.style_group] ?? 0) + 1;
      return acc;
    }, {});
    const needsReviewCount = allRows.filter(
      (row) => row.needs_review.styleGroup || row.needs_review.medium || row.needs_review.subMedium
    ).length;

    console.log('分類分佈：', distribution);
    console.log(`入庫總數：${allRows.length}，略過 ${skipped} 張，needsReview ${needsReviewCount} 筆`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
