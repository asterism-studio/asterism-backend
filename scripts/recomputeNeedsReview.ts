import 'dotenv/config';
import { Pool } from 'pg';
import { THRESHOLDS } from './enrich/taxonomy';

// 一次性腳本：用「已存在資料庫」的 confidence 值，套上目前 taxonomy.ts 的新門檻
// 重新計算每筆 needs_review，不重跑 CLIP。改門檻後執行一次即可。
//   執行：npx tsx scripts/recomputeNeedsReview.ts

interface NeedsReview {
  styleGroup: boolean;
  medium: boolean;
  subMedium: boolean;
}

interface Row {
  id: string;
  confidence: { styleGroup: number; medium: number; subMedium: number | null };
  needs_review: NeedsReview | null;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const { rows } = await pool.query<Row>('SELECT id, confidence, needs_review FROM images');
    let needsReviewCount = 0; // 重算後 needs_review 任一欄為 true 的筆數
    let updated = 0; // 實際與舊值不同、有寫回 DB 的筆數

    for (const row of rows) {
      const c = row.confidence;
      const next: NeedsReview = {
        styleGroup: c.styleGroup < THRESHOLDS.styleGroup,
        medium: c.medium < THRESHOLDS.medium,
        // subMedium 是強制猜出來的，一律送人工審核（與 enrich/classify.ts 一致）
        subMedium: true
      };

      if (next.styleGroup || next.medium || next.subMedium) {
        needsReviewCount += 1;
      }

      // 只在與現值不同時才寫，避免無謂的 DB 更新。
      const prev = row.needs_review;
      const unchanged =
        prev != null &&
        prev.styleGroup === next.styleGroup &&
        prev.medium === next.medium &&
        prev.subMedium === next.subMedium;
      if (unchanged) {
        continue;
      }

      await pool.query('UPDATE images SET needs_review = $1 WHERE id = $2', [
        JSON.stringify(next),
        row.id
      ]);
      updated += 1;
    }

    console.log(`套用門檻 styleGroup<${THRESHOLDS.styleGroup} / medium<${THRESHOLDS.medium} / subMedium<${THRESHOLDS.subMedium}`);
    console.log(`共 ${rows.length} 筆：實際更新 ${updated} 筆，其中 ${needsReviewCount} 筆 needs_review = true`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
