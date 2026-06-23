import type { Pool } from 'pg';
import type { ImageRow } from './buildImageRow';

export async function insertImageRows(pool: Pool, rows: ImageRow[]): Promise<void> {
  for (const row of rows) {
    await pool.query(
      // source 欄已從 schema 移除（見 migration sndefined）；row.source 仍用於組 id/attribution，只是不再入庫。
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
  }
}
