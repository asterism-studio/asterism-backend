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
  // 權限鎖定
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.set_consultation_location\(uuid, text\) FROM public, anon;/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.set_consultation_location\(uuid, text\) TO authenticated;/)
})
