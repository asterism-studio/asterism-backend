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

test('Prisma schema defines the consultant contract', async () => {
  const schema = await readPrismaSchema()

  assert.match(schema, /model Consultant \{/)
  assert.match(
    schema,
    /enum ConsultantSpecialty \{\s+spatial\s+visual_styling\s+concept_design\s+\}/
  )
  assert.match(
    schema,
    /displayName\s+String\s+@map\("display_name"\)\s+@db\.VarChar\(80\)/
  )
  assert.match(schema, /title\s+String\s+@db\.VarChar\(80\)/)
  assert.match(
    schema,
    /avatarUrl\s+String\?\s+@map\("avatar_url"\)\s+@db\.Text/
  )
  assert.match(schema, /bio\s+String\?\s+@db\.Text/)
  assert.match(schema, /specialty\s+ConsultantSpecialty\?/)
  assert.match(
    schema,
    /isActive\s+Boolean\s+@default\(true\)\s+@map\("is_active"\)/
  )
  assert.match(
    schema,
    /consultationBookings\s+ConsultationBooking\[\]/
  )
  assert.match(schema, /@@index\(\[specialty\]\)/)
  assert.match(schema, /@@index\(\[isActive\]\)/)
  assert.match(schema, /@@map\("consultants"\)/)
})

test('ConsultationBooking has an optional consultant relation', async () => {
  const schema = await readPrismaSchema()

  assert.match(
    schema,
    /consultantId\s+String\?\s+@map\("consultant_id"\)\s+@db\.Uuid/
  )
  assert.match(
    schema,
    /consultant\s+Consultant\?\s+@relation\(\s*fields: \[consultantId\],\s*references: \[id\],\s*onDelete: SetNull\s*\)/
  )
  assert.match(schema, /@@index\(\[consultantId\]\)/)
})
