import type { Pool } from 'pg';
import type { ImageRow } from './buildImageRow';

// 回傳實際新增筆數：ON CONFLICT DO NOTHING 撞 id 時 rowCount=0，故總和才是真正入庫數（非候選數）。
export async function insertImageRows(pool: Pool, rows: ImageRow[]): Promise<number> {
  let inserted = 0;
  for (const row of rows) {
    const result = await pool.query(
      // images 表已移除 source 欄（見 migration sndefined），故不寫入；圖片來源僅在 buildImageRow 用 meta.source 組 id/attribution。
      `INSERT INTO images (id, url, title, style_group, style, medium, sub_medium, color_palette, attribution, confidence, needs_review)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.url,
        row.title,
        row.style_group,
        row.style,
        row.medium,
        row.sub_medium,
        row.color_palette,
        row.attribution,
        JSON.stringify(row.confidence),
        JSON.stringify(row.needs_review)
      ]
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}
