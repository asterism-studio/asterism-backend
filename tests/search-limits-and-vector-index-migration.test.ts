import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

async function readMigrationSql(suffix: string): Promise<string> {
  const migrationsDirectory = path.resolve('prisma/migrations')
  const entries = await readdir(migrationsDirectory)
  const migrationDirectory = entries.find((entry) => entry.endsWith(suffix))

  assert.ok(migrationDirectory, `migration ending with "${suffix}" is missing`)

  return readFile(path.join(migrationsDirectory, migrationDirectory, 'migration.sql'), 'utf8')
}

test('search limits and vector index migration caps match_count and indexes embedding', async () => {
  const sql = await readMigrationSql('_add_search_limits_and_vector_index')

  // PR #32 review：兩支公開 RPC 都要夾住查詢筆數上限，避免 anon key 傳大數字撈整張表。
  assert.match(sql, /LIMIT LEAST\(match_count, 100\)/g)
  assert.equal((sql.match(/LIMIT LEAST\(match_count, 100\)/g) ?? []).length, 2)

  // PR #32 review：embedding 欄位要有向量索引，避免圖庫變大後全表掃描變慢。
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "images_embedding_hnsw_idx"/)
  assert.match(sql, /USING hnsw \("embedding" vector_cosine_ops\)/)

  // 兩支 RPC 簽名/回傳型別不變，只改 LIMIT 邏輯——CREATE OR REPLACE 而非 DROP+CREATE。
  assert.match(sql, /CREATE OR REPLACE FUNCTION search_images_by_embedding/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION search_similar_images/)
})
