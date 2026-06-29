import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const prismaDirectory = path.resolve('prisma')

const readPrismaSchema = async () => {
  const entries = await readdir(prismaDirectory)
  const schemaFiles = entries.filter((entry) => entry.endsWith('.prisma'))
  const contents = await Promise.all(
    schemaFiles.map((entry) =>
      readFile(path.join(prismaDirectory, entry), 'utf8')
    )
  )

  return contents.join('\n')
}

test('Prisma schema defines the consultation booking contract', async () => {
  const schema = await readPrismaSchema()

  assert.match(
    schema,
    /enum ConsultationMethod \{\s+online\s+in_person\s+\}/
  )
  assert.match(schema, /enum ConsultationTimeSlot \{\s+am\s+pm\s+\}/)
  assert.match(
    schema,
    /enum ConsultationBookingStatus \{\s+pending_payment\s+confirmed\s+payment_failed\s+canceled\s+completed\s+\}/
  )
  assert.match(schema, /model ConsultationBooking \{/)
  assert.match(schema, /profileId\s+String\s+@map\("profile_id"\)\s+@db\.Uuid/)
  assert.match(
    schema,
    /sourceImageId\s+String\?\s+@map\("source_image_id"\)\s+@db\.Text/
  )
  assert.match(
    schema,
    /consultationDate\s+DateTime\s+@map\("consultation_date"\)\s+@db\.Date/
  )
  assert.match(schema, /contactEmail\s+String\s+@map\("contact_email"\)/)
  assert.match(
    schema,
    /contactPhone\s+String\?\s+@map\("contact_phone"\)\s+@db\.Text/
  )
  assert.match(
    schema,
    /paymentConsentAcceptedAt\s+DateTime\s+@map\("payment_consent_accepted_at"\)\s+@db\.Timestamptz\(6\)/
  )
  assert.match(
    schema,
    /status\s+ConsultationBookingStatus\s+@default\(pending_payment\)/
  )
  assert.match(
    schema,
    /profile\s+Profile\s+@relation\(fields: \[profileId\], references: \[id\], onDelete: Restrict\)/
  )
  assert.match(
    schema,
    /sourceImage\s+Image\?\s+@relation\(fields: \[sourceImageId\], references: \[id\], onDelete: SetNull\)/
  )
})
