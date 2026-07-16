import 'dotenv/config';
import { Pool } from 'pg';
import {
  STYLE_GROUP_ANCHORS,
  MEDIUM_LABELS,
  buildGatePrompt,
  RELEVANCE_THRESHOLD
} from './taxonomy';
import { classifyImage } from './classify';
import { buildImageRow } from './buildImageRow';
import type { ImageRow } from './buildImageRow';
import { createClipScorer } from './clipScorer';
import { createClipEmbedder } from './clipEmbedder';
import { createClipTextEmbedder } from './textEmbedder';
import { dot } from './vectorMath';
import { extractPalette } from './colorPalette';
import { searchPexels } from './pexelsClient';
import { searchUnsplash } from './unsplashClient';
import { insertImageRows } from './dbWriter';

const IMAGES_PER_SOURCE = 5; // 5 Pexels + 5 Unsplash = 10 張/組合；9 styleGroup × 4 medium = 36 組合 = 360 張

// 想抓下一波（避免重複拿到同一批）就用 ENRICH_PAGE=2、3… 換頁；預設第 1 頁。
const PAGE = Math.max(1, Number(process.env.ENRICH_PAGE) || 1);

// off：完全不算 embedding（省效能，抓圖先衝量時用）；dry-run：算但只記 log 不刷掉（預設）；
// enforce：低於門檻真的不入庫。
type GateMode = 'off' | 'dry-run' | 'enforce';
const GATE_MODE: GateMode =
  process.env.GATE_MODE === 'off' || process.env.GATE_MODE === 'enforce'
    ? process.env.GATE_MODE
    : 'dry-run';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // try/finally 確保中途拋錯時 pool 仍會關閉，避免連線洩漏。
  try {
    const scorer = await createClipScorer();
    // GATE_MODE=off 時完全不載入 CLIP embedding 模型，省下模型初始化與逐張推論的時間。
    const embedder = GATE_MODE === 'off' ? null : await createClipEmbedder();
    const textEmbedder = GATE_MODE === 'off' ? null : await createClipTextEmbedder();
    let gateFlagged = 0; // 算出來低於門檻的張數（不論是否真的刷掉）
    let gateRejected = 0; // 實際被刷掉、沒入庫的張數（僅 enforce 模式會 > 0）
    const allRows: ImageRow[] = [];
    let skipped = 0;
    let totalInserted = 0;

    for (const [styleGroup, anchorPrompt] of Object.entries(STYLE_GROUP_ANCHORS)) {
      // 每個 styleGroup 再依 medium 各搜一次，補足各媒材的圖；
      // query 帶上 medium 只是「偏向去抓該媒材」，分類仍由 CLIP 依圖片本身判定。
      for (const medium of MEDIUM_LABELS) {
        const query = `${anchorPrompt} ${medium}`;
        // gate prompt 與搜尋 query 拆開：搜尋走關鍵字，gate 走自然語言句（見 taxonomy.ts）。
        // GATE_MODE=off 不算 gate，省下這次文字 embedding。
        const gateVector =
          GATE_MODE === 'off'
            ? null
            : (await textEmbedder!.embedTexts([buildGatePrompt(styleGroup, medium)]))[0];
        // allSettled：單一來源（Pexels/Unsplash）整批失敗（如 rate limit / 網路）只略過該來源，
        // 不讓整個 main() throw，後續 styleGroup / medium 仍會繼續跑。
        const [pexelsSettled, unsplashSettled] = await Promise.allSettled([
          searchPexels(query, IMAGES_PER_SOURCE, PAGE),
          searchUnsplash(query, IMAGES_PER_SOURCE, PAGE)
        ]);
        if (pexelsSettled.status === 'rejected') {
          console.warn(`[${styleGroup} / ${medium}] Pexels 搜尋失敗：`, pexelsSettled.reason);
        }
        if (unsplashSettled.status === 'rejected') {
          console.warn(`[${styleGroup} / ${medium}] Unsplash 搜尋失敗：`, unsplashSettled.reason);
        }
        const pexelsResults = pexelsSettled.status === 'fulfilled' ? pexelsSettled.value : [];
        const unsplashResults = unsplashSettled.status === 'fulfilled' ? unsplashSettled.value : [];

        const groupRows: ImageRow[] = [];
        for (const meta of [...pexelsResults, ...unsplashResults]) {
          // 單張失敗（抓不到圖／取色失敗／CLIP 無法處理）只跳過該張，不拖累整批。
          try {
            // GATE_MODE=off 時 embedder 是 null，完全不算 embedding（省效能）；
            // 否則算一次，gate 判斷跟入庫存值共用同一個向量，不重複跑 CLIP。
            const embedding = embedder ? await embedder.embedImage(meta.url) : null;
            if (GATE_MODE !== 'off') {
              const relevance = dot(embedding!, gateVector!);
              if (relevance < RELEVANCE_THRESHOLD) {
                gateFlagged += 1;
                console.log(
                  `[gate ${GATE_MODE}][${styleGroup} / ${medium}] ${meta.url} relevance=${relevance.toFixed(3)}`
                );
                if (GATE_MODE === 'enforce') {
                  gateRejected += 1;
                  continue;
                }
              }
            }
            const classification = await classifyImage(scorer, meta.url);
            const palette = await extractPalette(meta.url);
            groupRows.push(buildImageRow(classification, palette, meta, embedding));
          } catch (error) {
            skipped += 1;
            console.warn(`[${styleGroup} / ${medium}] 跳過 ${meta.url}：`, (error as Error).message);
          }
        }

        // 每組合各寫一次：後面失敗，前面已處理的仍已入庫（insertImageRows 為 ON CONFLICT DO NOTHING，可重跑）。
        const inserted = await insertImageRows(pool, groupRows);
        totalInserted += inserted;
        allRows.push(...groupRows);
        // groupRows 是候選數；inserted 才是實際新增（撞 id 的會被 ON CONFLICT 略過）。
        console.log(
          `[p${PAGE}][${styleGroup} / ${medium}] 候選 ${groupRows.length} 張，實際入庫 ${inserted} 張`
        );
      }
    }

    const distribution = allRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.style_group] = (acc[row.style_group] ?? 0) + 1;
      return acc;
    }, {});
    // styleGroup × medium 二維分布：看每個風格群組實際長出了哪些媒材、各幾張（CLIP 判定結果）。
    const groupMediumDistribution = allRows.reduce<Record<string, Record<string, number>>>(
      (acc, row) => {
        const byMedium = (acc[row.style_group] ??= {});
        const medium = row.medium ?? '(none)';
        byMedium[medium] = (byMedium[medium] ?? 0) + 1;
        return acc;
      },
      {}
    );
    const needsReviewCount = allRows.filter(
      (row) => row.needs_review.styleGroup || row.needs_review.medium || row.needs_review.subMedium
    ).length;

    console.log('分類分佈（styleGroup）：', distribution);
    console.log('分類分佈（styleGroup × medium）：', groupMediumDistribution);
    // allRows.length 是候選總數；totalInserted 才是這次實際新增（其餘為重跑撞 id 略過）。
    console.log(
      `第 ${PAGE} 頁 候選總數：${allRows.length}，實際入庫 ${totalInserted} 張，略過 ${skipped} 張，` +
        `gate 標記 ${gateFlagged} 張／實際刷掉 ${gateRejected} 張（GATE_MODE=${GATE_MODE}），needsReview ${needsReviewCount} 筆`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
