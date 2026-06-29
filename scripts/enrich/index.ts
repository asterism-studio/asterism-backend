import 'dotenv/config';
import { Pool } from 'pg';
import { STYLE_GROUP_ANCHORS, MEDIUM_LABELS } from './taxonomy';
import { classifyImage } from './classify';
import { buildImageRow } from './buildImageRow';
import type { ImageRow } from './buildImageRow';
import { createClipScorer } from './clipScorer';
import { extractPalette } from './colorPalette';
import { searchPexels } from './pexelsClient';
import { searchUnsplash } from './unsplashClient';
import { insertImageRows } from './dbWriter';

const IMAGES_PER_SOURCE = 5; // 5 Pexels + 5 Unsplash = 10 張/組合；9 styleGroup × 4 medium = 36 組合 = 360 張

// 想抓下一波（避免重複拿到同一批）就用 ENRICH_PAGE=2、3… 換頁；預設第 1 頁。
const PAGE = Math.max(1, Number(process.env.ENRICH_PAGE) || 1);

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // try/finally 確保中途拋錯時 pool 仍會關閉，避免連線洩漏。
  try {
    const scorer = await createClipScorer();
    const allRows: ImageRow[] = [];
    let skipped = 0;

    for (const [styleGroup, anchorPrompt] of Object.entries(STYLE_GROUP_ANCHORS)) {
      // 每個 styleGroup 再依 medium 各搜一次，補足各媒材的圖；
      // query 帶上 medium 只是「偏向去抓該媒材」，分類仍由 CLIP 依圖片本身判定。
      for (const medium of MEDIUM_LABELS) {
        const query = `${anchorPrompt} ${medium}`;
        const [pexelsResults, unsplashResults] = await Promise.all([
          searchPexels(query, IMAGES_PER_SOURCE, PAGE),
          searchUnsplash(query, IMAGES_PER_SOURCE, PAGE)
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
            console.warn(`[${styleGroup} / ${medium}] 跳過 ${meta.url}：`, (error as Error).message);
          }
        }

        // 每組合各寫一次：後面失敗，前面已處理的仍已入庫（insertImageRows 為 ON CONFLICT DO NOTHING，可重跑）。
        await insertImageRows(pool, groupRows);
        allRows.push(...groupRows);
        console.log(`[p${PAGE}][${styleGroup} / ${medium}] 入庫 ${groupRows.length} 張`);
      }
    }

    const distribution = allRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.style_group] = (acc[row.style_group] ?? 0) + 1;
      return acc;
    }, {});
    const needsReviewCount = allRows.filter(
      (row) => row.needs_review.styleGroup || row.needs_review.medium || row.needs_review.subMedium
    ).length;

    console.log('分類分佈：', distribution);
    console.log(
      `第 ${PAGE} 頁 入庫總數：${allRows.length}，略過 ${skipped} 張，needsReview ${needsReviewCount} 筆`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
