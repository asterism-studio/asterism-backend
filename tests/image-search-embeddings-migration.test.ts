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

test('image search embeddings migration adds pgvector column, anchors table, RLS, and RPC', async () => {
  const sql = await readMigrationSql('_add_image_search_embeddings')

  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/)
  assert.match(sql, /ALTER TABLE "images"\s+ADD COLUMN "embedding" vector\(512\)/)

  assert.match(sql, /CREATE TABLE "classification_anchors"/)
  assert.match(sql, /"dimension" TEXT NOT NULL/)
  assert.match(sql, /"label" TEXT NOT NULL/)
  assert.match(sql, /"embedding" vector\(512\) NOT NULL/)
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "classification_anchors_dimension_label_key"\s+ON "classification_anchors"\("dimension", "label"\)/
  )

  assert.match(sql, /ALTER TABLE "classification_anchors" ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /CREATE POLICY "classification_anchors_public_read"/)
  assert.match(
    sql,
    /CREATE POLICY "classification_anchors_public_read"[\s\S]*?TO anon, authenticated[\s\S]*?USING \(true\)/
  )
  // 只有一條 policy、只讀不寫：不開放公開寫入。
  assert.equal((sql.match(/CREATE POLICY/g) ?? []).length, 1)
  assert.doesNotMatch(sql, /FOR (?:INSERT|UPDATE|DELETE|ALL)/)

  assert.match(sql, /CREATE OR REPLACE FUNCTION search_images_by_embedding/)
  assert.match(sql, /query_embedding vector\(512\)/)
  assert.match(sql, /p_style_group text/)
  assert.match(sql, /match_count int DEFAULT 4/)
  assert.match(sql, /images\.style_group = p_style_group/)
  assert.match(sql, /images\.excluded = false/)
  assert.match(sql, /\(images\.needs_review->>'styleGroup'\)::boolean = false/)
  assert.match(sql, /\(images\.needs_review->>'medium'\)::boolean = false/)
  assert.match(sql, /\(images\.needs_review->>'subMedium'\)::boolean = false/)
  assert.match(sql, /ORDER BY images\.embedding <=> query_embedding/)
  assert.match(sql, /LIMIT match_count/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION search_images_by_embedding[\s\S]*?TO anon, authenticated/)
})
