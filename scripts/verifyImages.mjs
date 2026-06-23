import 'dotenv/config'
import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const q = async (s) => (await c.query(s)).rows[0]
const total = (await q('select count(*)::int n from images')).n
const grp = (await q('select count(distinct style_group)::int g from images')).g
const nr = (await q("select count(*)::int n from images where (needs_review->>'medium')::bool or (needs_review->>'subMedium')::bool")).n
const src = (await q("select count(*)::int n from information_schema.columns where table_name='images' and column_name='source'")).n
console.log(`總計: ${total} | 風格組: ${grp} | needs_review(任一true): ${nr} | source欄存在: ${src > 0}`)
await c.end()
