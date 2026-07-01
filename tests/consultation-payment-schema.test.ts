import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const readConsultationSchema = () =>
  readFile(path.resolve('prisma/consultation.prisma'), 'utf8')

test('Prisma schema defines the consultation payment valid values', async () => {
  const schema = await readConsultationSchema()

  assert.match(
    schema,
    /enum ConsultationPaymentProvider \{\s+stripe\s+\}/
  )
  assert.match(
    schema,
    /enum ConsultationPaymentStatus \{\s+pending\s+paid\s+failed\s+canceled\s+refunded\s+\}/
  )
})

test('Prisma schema defines a one-to-one consultation payment contract', async () => {
  const schema = await readConsultationSchema()

  assert.match(schema, /model ConsultationPayment \{/)
  assert.match(
    schema,
    /bookingId\s+String\s+@unique\s+@map\("booking_id"\)\s+@db\.Uuid/
  )
  assert.match(
    schema,
    /providerCheckoutSessionId\s+String\?\s+@unique\s+@map\("provider_checkout_session_id"\)\s+@db\.Text/
  )
  assert.match(
    schema,
    /providerPaymentIntentId\s+String\?\s+@unique\s+@map\("provider_payment_intent_id"\)\s+@db\.Text/
  )
  assert.match(schema, /stripePriceId\s+String\s+@map\("stripe_price_id"\)/)
  assert.match(schema, /amount\s+Int/)
  assert.match(schema, /currency\s+String\s+@default\("TWD"\)/)
  assert.match(
    schema,
    /status\s+ConsultationPaymentStatus\s+@default\(pending\)/
  )
  assert.match(
    schema,
    /booking\s+ConsultationBooking\s+@relation\(fields: \[bookingId\], references: \[id\], onDelete: Cascade\)/
  )
  assert.match(schema, /@@map\("consultation_payments"\)/)
})
