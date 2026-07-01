import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

test('consultation migration creates the schema and locks it down with RLS', async () => {
  const migrationsDirectory = path.resolve('prisma/migrations')
  const entries = await readdir(migrationsDirectory)
  const migrationDirectory = entries.find((entry) =>
    entry.endsWith('_add_consultation_schema_and_rls')
  )

  assert.ok(migrationDirectory, 'consultation schema and RLS migration is missing')

  const sql = await readFile(
    path.join(migrationsDirectory, migrationDirectory, 'migration.sql'),
    'utf8'
  )

  for (const table of [
    'consultants',
    'consultation_bookings',
    'consultation_payments',
    'stripe_webhook_events'
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`))
    assert.match(
      sql,
      new RegExp(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`)
    )
  }

  assert.match(sql, /CHECK \("amount" > 0\)/)
  assert.match(sql, /CHECK \("currency" = 'TWD'\)/)
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "consultation_bookings_slot_unique" ON "consultation_bookings"\("consultation_date", "time_slot"\) WHERE "status" IN \('confirmed', 'completed'\);/
  )
  assert.match(sql, /CREATE POLICY "consultants_public_read_active"/)
  assert.match(
    sql,
    /CREATE POLICY "consultants_public_read_active"[\s\S]*?TO anon, authenticated[\s\S]*?USING \("is_active" = true\)/
  )
  assert.match(sql, /CREATE POLICY "consultation_bookings_select_own"/)
  assert.match(sql, /CREATE POLICY "consultation_payments_select_own"/)
  assert.match(
    sql,
    /consultation_payments_booking_id_fkey" FOREIGN KEY \("booking_id"\)[\s\S]*?ON DELETE CASCADE/
  )
  assert.doesNotMatch(sql, /FOR (?:INSERT|UPDATE|DELETE|ALL)/)
  assert.equal((sql.match(/CREATE POLICY/g) ?? []).length, 3)
  assert.equal((sql.match(/FOR SELECT/g) ?? []).length, 3)
})

test('checkout stability migration separates idempotency and permits payment drafts', async () => {
  const migrationsDirectory = path.resolve('prisma/migrations')
  const entries = await readdir(migrationsDirectory)
  const migrationDirectory = entries.find((entry) =>
    entry.endsWith('_stabilize_consultation_checkout')
  )

  assert.ok(migrationDirectory, 'checkout stability migration is missing')

  const sql = await readFile(
    path.join(migrationsDirectory, migrationDirectory, 'migration.sql'),
    'utf8'
  )

  assert.match(sql, /ADD COLUMN "idempotency_key" UUID/)
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "consultation_bookings_profile_id_idempotency_key_key"/
  )
  assert.match(
    sql,
    /ALTER COLUMN "provider_checkout_session_id" DROP NOT NULL/
  )
})
