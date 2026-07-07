import 'dotenv/config';
import { Pool } from 'pg';

// 一次性腳本：回填既有資料庫列缺少的 source_url（圖片原始出處頁面連結）。
// 當初 enrich pipeline 只抓了圖片素材網址存進 url 欄，沒有另外抓 Pexels/Unsplash
// 各自的「原始頁面連結」欄位，導致既有列的 source_url 全部是 null，得回頭反查。
// 只處理 id 符合 ext-{pexels|unsplash}-{externalId} 的列；本地/Asterism 自製圖沒有
// 外部出處頁面，source_url 維持 null，不在這支腳本處理範圍內。
//   執行：npx tsx scripts/backfillSourceUrl.ts
// 注意：Unsplash demo app 額度只有 50 requests/hour，圖多的話可能要跑好幾次——
// 腳本只抓 source_url IS NULL 的列，可以重複執行到全部補完為止。

const EXTERNAL_ID_PATTERN = /^ext-(pexels|unsplash)-(.+)$/;

interface ParsedExternalId {
  source: 'pexels' | 'unsplash';
  externalId: string;
}

// 純邏輯：從既有 id（ext-{source}-{externalId}）反查來源與原始 external id。
// 本地/Asterism 自製圖的 id 不符這個格式，回傳 null 由呼叫端略過。
export function parseExternalId(id: string): ParsedExternalId | null {
  const match = id.match(EXTERNAL_ID_PATTERN);
  if (!match) return null;
  return { source: match[1] as 'pexels' | 'unsplash', externalId: match[2] };
}

async function fetchPexelsSourceUrl(externalId: string, apiKey: string): Promise<string> {
  const response = await fetch(`https://api.pexels.com/v1/photos/${externalId}`, {
    headers: { Authorization: apiKey }
  });
  if (!response.ok) {
    throw new Error(`Pexels API 失敗：${response.status}`);
  }
  const photo = (await response.json()) as { url: string };
  return photo.url;
}

async function fetchUnsplashSourceUrl(externalId: string, accessKey: string): Promise<string> {
  const response = await fetch(`https://api.unsplash.com/photos/${externalId}`, {
    headers: { Authorization: `Client-ID ${accessKey}` }
  });
  if (!response.ok) {
    throw new Error(`Unsplash API 失敗：${response.status}`);
  }
  const photo = (await response.json()) as { links: { html: string } };
  return photo.links.html;
}

async function main(): Promise<void> {
  const pexelsApiKey = process.env.PEXELS_API_KEY;
  const unsplashAccessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!pexelsApiKey || !unsplashAccessKey) {
    throw new Error('PEXELS_API_KEY / UNSPLASH_ACCESS_KEY 未設定');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM images WHERE source_url IS NULL AND id LIKE 'ext-%'`
    );

    let updated = 0;
    let skipped = 0;
    let rateLimited = 0;
    // 兩個來源的額度是分開的；一個撞到就跳過同來源剩下的列，不要連另一個來源也一起停下來。
    const rateLimitedSources = new Set<'pexels' | 'unsplash'>();

    for (const row of rows) {
      const parsed = parseExternalId(row.id);
      if (!parsed) {
        skipped += 1;
        console.warn(`略過 ${row.id}（id 格式不符 ext-{pexels|unsplash}-{externalId}）`);
        continue;
      }

      if (rateLimitedSources.has(parsed.source)) {
        skipped += 1;
        continue;
      }

      try {
        const sourceUrl =
          parsed.source === 'pexels'
            ? await fetchPexelsSourceUrl(parsed.externalId, pexelsApiKey)
            : await fetchUnsplashSourceUrl(parsed.externalId, unsplashAccessKey);

        await pool.query('UPDATE images SET source_url = $2 WHERE id = $1', [row.id, sourceUrl]);
        updated += 1;
      } catch (error) {
        const message = (error as Error).message;
        if (message.includes('429') || message.includes('403')) {
          rateLimited += 1;
          rateLimitedSources.add(parsed.source);
          console.warn(`[${parsed.source}] 疑似撞到 rate limit，這個來源之後的列先跳過：`, message);
          continue;
        }
        skipped += 1;
        console.warn(`[${row.id}] 補回 source_url 失敗，略過：`, message);
      }
    }

    console.log(
      `共 ${rows.length} 筆待補，更新 ${updated} 筆、略過 ${skipped} 筆、疑似 rate limit 中止 ${rateLimited} 筆`
    );
    if (rateLimited > 0) {
      console.log('額度用完，晚點重跑這支腳本即可（只會處理還沒補到的列）。');
    }
  } finally {
    await pool.end();
  }
}

// 測試 import 此模組時不連線資料庫（vitest 會設定 process.env.VITEST）。
if (!process.env.VITEST) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
