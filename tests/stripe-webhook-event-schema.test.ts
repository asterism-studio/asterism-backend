import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const readConsultationSchema = () =>
  readFile(path.resolve('prisma/consultation.prisma'), 'utf8')

test('Prisma schema defines the Stripe webhook event idempotency contract', async () => {
  const schema = await readConsultationSchema()

  assert.match(schema, /model StripeWebhookEvent \{/)
  assert.match(
    schema,
    /stripeEventId\s+String\s+@unique\s+@map\("stripe_event_id"\)\s+@db\.Text/
  )
  assert.match(
    schema,
    /eventType\s+String\s+@map\("event_type"\)\s+@db\.Text/
  )
  assert.match(schema, /payload\s+Json/)
  assert.match(
    schema,
    /processedAt\s+DateTime\?\s+@map\("processed_at"\)\s+@db\.Timestamptz\(6\)/
  )
  assert.match(
    schema,
    /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)\s+@db\.Timestamptz\(6\)/
  )
  assert.match(schema, /@@map\("stripe_webhook_events"\)/)
})
