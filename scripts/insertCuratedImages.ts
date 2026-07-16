import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { createClipEmbedder } from './enrich/clipEmbedder';
import { extractPalette } from './enrich/colorPalette';
import { insertImageRows } from './enrich/dbWriter';
import type { ImageRow } from './enrich/buildImageRow';

// 一次性腳本：把組員自己 AI 生成、人工策展好的圖片寫進 images 表。
// 跟 enrich pipeline 抓的圖不同——這些是「我們自己要的」，不用 CLIP 猜分類、
// 不用 gate、不用送審：confidence 全設 1、needs_review 全設 false。
// embedding 還是要算（給以圖搜圖用），但拿本機檔案算，不用等圖片部署上線。
//   執行：npx tsx scripts/insertCuratedImages.ts <json路徑> <圖片資料夾路徑>

interface CuratedEntry {
  id: string;
  url: string;
  title: string;
  styleGroup: string;
  style: string[];
  medium: string;
  subMedium: string;
  colorPalette: string[];
  attribution?: string;
}

async function main(): Promise<void> {
  const jsonPath = process.argv[2];
  const imageDir = process.argv[3];
  if (!jsonPath || !imageDir) {
    console.error('用法：npx tsx scripts/insertCuratedImages.ts <json路徑> <圖片資料夾路徑>');
    process.exit(1);
  }

  const entries: CuratedEntry[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`讀到 ${entries.length} 筆資料`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const embedder = await createClipEmbedder();
    const rows: ImageRow[] = [];
    let skipped = 0;

    for (const [i, entry] of entries.entries()) {
      const localPath = path.join(imageDir, `${entry.id}.webp`);
      if (!fs.existsSync(localPath)) {
        console.warn(`跳過 ${entry.id}：本機找不到 ${localPath}`);
        skipped += 1;
        continue;
      }

      try {
        const embedding = await embedder.embedImage(localPath);
        // colorPalette 用 JSON 裡策展好的值，不重新算（避免跟人工挑色不一致）。
        rows.push({
          id: entry.id,
          url: entry.url,
          title: entry.title,
          style_group: entry.styleGroup,
          style: entry.style,
          medium: entry.medium,
          sub_medium: entry.subMedium,
          color_palette: entry.colorPalette,
          attribution: entry.attribution ?? 'Asterism',
          confidence: { styleGroup: 1, medium: 1, subMedium: 1 },
          needs_review: { styleGroup: false, medium: false, subMedium: false },
          embedding
        });
        console.log(`[${i + 1}/${entries.length}] ${entry.id} embedding 完成`);
      } catch (error) {
        console.warn(`跳過 ${entry.id}：`, (error as Error).message);
        skipped += 1;
      }
    }

    const inserted = await insertImageRows(pool, rows);
    console.log(`\n共 ${entries.length} 筆，候選 ${rows.length} 筆，實際入庫 ${inserted} 筆，略過 ${skipped} 筆`);
    console.log('（入庫數 < 候選數代表撞到已存在的 id，ON CONFLICT DO NOTHING 略過，可重跑）');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
