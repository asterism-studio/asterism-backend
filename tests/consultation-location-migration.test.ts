import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

test('location migration adds the column and a locked-down RPC', async () => {
  const dir = path.resolve('prisma/migrations')
  const entries = await readdir(dir)
  const found = entries.find((e: string) =>
    e.endsWith('_add_consultation_location_and_rpc')
  )
  assert.ok(found, 'location migration is missing')

  const sql = await readFile(path.join(dir, found, 'migration.sql'), 'utf8')

  assert.match(sql, /ALTER TABLE "consultation_bookings" ADD COLUMN "location" TEXT;/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.set_consultation_location/)
  assert.match(sql, /SECURITY DEFINER/i)
  assert.match(sql, /SET search_path = public/i)
  // 只改 location、且限 confirmed + 被指派顧問
  assert.match(sql, /set\s+location\s*=/i)
  assert.match(sql, /status\s*=\s*'confirmed'/i)
  assert.match(sql, /consultant_id in \(\s*select c\.id from consultants c where c\.profile_id = auth\.uid\(\)/i)
  // 兩個授權條件必須用 AND 合併在同一個 WHERE 子句(防止未來被誤改成 OR,或條件被拆散),
  // 且必須有 NOT FOUND 才 RAISE 的守門(防止授權失敗時被靜默忽略)
  assert.match(
    sql,
    /where[\s\S]*?status\s*=\s*'confirmed'[\s\S]*?and[\s\S]*?consultant_id in \(\s*select c\.id from consultants c where c\.profile_id = auth\.uid\(\)/i
  )
  assert.match(sql, /if not found then\s*raise exception[\s\S]*?42501/i)
  // 權限鎖定
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.set_consultation_location\(uuid, text\) FROM public, anon;/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.set_consultation_location\(uuid, text\) TO authenticated;/)
})
