// 把備份的 239 張外部圖塞回 Supabase images 表。
// 備份來源：D:\asterism-backend-feat-schema-base\backups\images_backup_2026-06-23.json
// 注意：images 表已 DROP COLUMN source（見 migration sndefined），故插入時略過 source。
// 可重跑：ON CONFLICT (id) DO NOTHING。
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const BACKUP = 'D:/asterism-backend-feat-schema-base/backups/images_backup_2026-06-23.json'
const rows = JSON.parse(readFileSync(BACKUP, 'utf8'))
if (!Array.isArray(rows)) throw new Error('備份不是陣列')

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
let inserted = 0
try {
  await c.query('BEGIN')
  for (const r of rows) {
    const res = await c.query(
      `INSERT INTO images
        (id,url,title,style_group,style,medium,sub_medium,color_palette,attribution,confidence,needs_review,created_at,excluded)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,now()),$13)
       ON CONFLICT (id) DO NOTHING`,
      [
        r.id, r.url, r.title, r.style_group,
        r.style ?? [], r.medium ?? null, r.sub_medium ?? null, r.color_palette ?? [],
        r.attribution, JSON.stringify(r.confidence), JSON.stringify(r.needs_review),
        r.created_at ?? null, r.excluded ?? false,
      ],
    )
    inserted += res.rowCount
  }
  await c.query('COMMIT')
} catch (e) {
  await c.query('ROLLBACK')
  throw e
} finally {
  const { rows: [{ n }] } = await c.query('SELECT count(*)::int n FROM images')
  console.log(`備份筆數: ${rows.length} / 新插入: ${inserted} / 表內總計: ${n}`)
  await c.end()
}
