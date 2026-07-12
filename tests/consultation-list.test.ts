import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import test from 'node:test'

import express, { type Express } from 'express'

import type { Prisma, PrismaClient } from '../src/generated/prisma/client.js'
import { AppError, errorHandler } from '../src/middleware/errorHandler.js'
import { createConsultationRouter } from '../src/modules/consultation/routes.js'
import {
  consultationListQuerySchema
} from '../src/modules/consultation/schema.js'
import {
  createConsultationListService
} from '../src/modules/consultation/service.js'
import {
  createConsultationRepository
} from '../src/modules/consultation/repository.js'
import {
  decodeConsultationListCursor,
  encodeConsultationListCursor
} from '../src/modules/consultation/pagination.js'
import type { AuthContext } from '../src/modules/auth/auth.types.js'
import type {
  BookingStatus,
  ConsultationListCursor,
  MyConsultationListRecord
} from '../src/modules/consultation/types.js'

const auth: AuthContext = {
  userId: '650e8400-e29b-41d4-a716-446655440000',
  email: null
}
const profileId = '750e8400-e29b-41d4-a716-446655440000'

const createRecord = (
  overrides: Partial<MyConsultationListRecord> = {}
): MyConsultationListRecord => ({
  id: '850e8400-e29b-41d4-a716-446655440000',
  status: 'confirmed',
  method: 'online',
  consultationDate: '2099-07-01',
  timeSlot: 'am',
  designField: 'Styling design',
  designFocus: 'Material palette',
  notes: 'Keep the room calm.',
  createdAt: new Date('2099-06-01T00:00:00.000Z'),
  consultant: {
    displayName: 'Asterism Consultant',
    title: 'Design Consultant',
    avatarUrl: 'https://example.com/avatar.png'
  },
  ...overrides
})

const hasError =
  (statusCode: number, code: string) =>
  (error: unknown): boolean =>
    error instanceof AppError &&
    error.statusCode === statusCode &&
    error.code === code

test('consultation list query schema applies defaults and rejects invalid input', () => {
  assert.deepEqual(consultationListQuerySchema.parse({}), { limit: 20 })
  assert.deepEqual(
    consultationListQuerySchema.parse({ status: 'confirmed', limit: '2' }),
    { status: 'confirmed', limit: 2 }
  )

  for (const query of [
    { status: 'unknown' },
    { limit: '0' },
    { limit: '51' },
    { limit: '1.5' },
    { unexpected: 'value' }
  ]) {
    assert.equal(consultationListQuerySchema.safeParse(query).success, false)
  }
})

test('consultation list cursor round-trips and validates query context', () => {
  const cursor: ConsultationListCursor = {
    version: 1,
    status: 'confirmed',
    consultationDate: '2099-07-01',
    timeSlot: 'am',
    id: '850e8400-e29b-41d4-a716-446655440000'
  }

  const encoded = encodeConsultationListCursor(cursor)
  assert.deepEqual(decodeConsultationListCursor(encoded, 'confirmed'), cursor)
  const unfilteredCursor: ConsultationListCursor = {
    version: 1,
    consultationDate: cursor.consultationDate,
    timeSlot: cursor.timeSlot,
    id: cursor.id
  }
  const unfilteredEncoded = encodeConsultationListCursor(unfilteredCursor)
  assert.deepEqual(
    decodeConsultationListCursor(unfilteredEncoded),
    unfilteredCursor
  )
  assert.throws(
    () => decodeConsultationListCursor(unfilteredEncoded, 'confirmed'),
    hasError(400, 'VALIDATION_ERROR')
  )
  assert.throws(
    () => decodeConsultationListCursor(encoded),
    hasError(400, 'VALIDATION_ERROR')
  )

  for (const value of [
    'not-base64-json',
    encodeConsultationListCursor({ ...cursor, version: 2 as 1 }),
    encodeConsultationListCursor({ ...cursor, consultationDate: '2099-02-30' }),
    encodeConsultationListCursor({
      ...cursor,
      id: 'not-a-uuid'
    })
  ]) {
    assert.throws(
      () => decodeConsultationListCursor(value, 'confirmed'),
      hasError(400, 'VALIDATION_ERROR')
    )
  }

  assert.throws(
    () => decodeConsultationListCursor(encoded, 'completed'),
    hasError(400, 'VALIDATION_ERROR')
  )
})

test('consultation list service resolves profile and maps paginated records', async () => {
  const first = createRecord({
    id: '850e8400-e29b-41d4-a716-446655440000',
    notes: '  preserve this text  '
  })
  const second = createRecord({
    id: '950e8400-e29b-41d4-a716-446655440000',
    designField: '',
    designFocus: '   ',
    notes: null,
    consultant: null
  })
  const extra = createRecord({
    id: 'a50e8400-e29b-41d4-a716-446655440000'
  })
  const calls: Array<{
    profileId: string
    status?: BookingStatus
    limit: number
    cursor?: ConsultationListCursor
  }> = []
  const cursor: ConsultationListCursor = {
    version: 1,
    status: 'confirmed',
    consultationDate: '2099-06-30',
    timeSlot: 'pm',
    id: '550e8400-e29b-41d4-a716-446655440000'
  }

  const list = createConsultationListService({
    findProfile: async () => ({ id: profileId, displayName: null }),
    findMyBookings: async (input) => {
      calls.push(input)
      return [first, second, extra]
    }
  })

  const result = await list({
    auth,
    query: {
      status: 'confirmed',
      limit: 2,
      cursor: encodeConsultationListCursor(cursor)
    }
  })

  assert.deepEqual(calls, [
    {
      profileId,
      status: 'confirmed',
      limit: 2,
      cursor
    }
  ])
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0]?.notes, '  preserve this text  ')
  assert.equal('designField' in result.items[1]!, false)
  assert.equal('designFocus' in result.items[1]!, false)
  assert.equal('notes' in result.items[1]!, false)
  assert.equal('consultant' in result.items[1]!, false)
  assert.equal(typeof result.nextCursor, 'string')
  assert.deepEqual(
    decodeConsultationListCursor(result.nextCursor!, 'confirmed'),
    {
      version: 1,
      status: 'confirmed',
      consultationDate: second.consultationDate,
      timeSlot: second.timeSlot,
      id: second.id
    }
  )
})

test('consultation list service rejects an authenticated user without a profile', async () => {
  const list = createConsultationListService({
    findProfile: async () => null,
    findMyBookings: async () => []
  })

  await assert.rejects(
    list({ auth, query: { limit: 20 } }),
    hasError(404, 'PROFILE_NOT_FOUND')
  )
})

test('consultation repository applies owner scope and explicit enum seek conditions', async () => {
  const calls: Prisma.ConsultationBookingFindManyArgs[] = []
  const database = {
    consultationBooking: {
      findMany: async (args: Prisma.ConsultationBookingFindManyArgs) => {
        calls.push(args)
        return []
      }
    }
  } as unknown as PrismaClient
  const repository = createConsultationRepository(database)
  const amCursor: ConsultationListCursor = {
    version: 1,
    status: 'confirmed',
    consultationDate: '2099-07-01',
    timeSlot: 'am',
    id: '850e8400-e29b-41d4-a716-446655440000'
  }
  const pmCursor = { ...amCursor, timeSlot: 'pm' as const }

  await repository.findMyBookings({
    profileId,
    status: 'confirmed',
    limit: 20,
    cursor: amCursor
  })
  await repository.findMyBookings({
    profileId,
    status: 'confirmed',
    limit: 20,
    cursor: pmCursor
  })

  assert.deepEqual(calls[0]?.where, {
    profileId,
    status: 'confirmed',
    AND: {
      OR: [
        { consultationDate: { gt: new Date('2099-07-01T00:00:00.000Z') } },
        {
          consultationDate: new Date('2099-07-01T00:00:00.000Z'),
          timeSlot: 'pm'
        },
        {
          consultationDate: new Date('2099-07-01T00:00:00.000Z'),
          timeSlot: 'am',
          id: { gt: amCursor.id }
        }
      ]
    }
  })
  assert.deepEqual(calls[1]?.where, {
    profileId,
    status: 'confirmed',
    AND: {
      OR: [
        { consultationDate: { gt: new Date('2099-07-01T00:00:00.000Z') } },
        {
          consultationDate: new Date('2099-07-01T00:00:00.000Z'),
          timeSlot: 'pm',
          id: { gt: pmCursor.id }
        }
      ]
    }
  })
  assert.deepEqual(calls[0]?.orderBy, [
    { consultationDate: 'asc' },
    { timeSlot: 'asc' },
    { id: 'asc' }
  ])
  assert.equal(calls[0]?.take, 21)
  assert.deepEqual(calls[0]?.select, {
    id: true,
    status: true,
    method: true,
    consultationDate: true,
    timeSlot: true,
    designField: true,
    designFocus: true,
    notes: true,
    createdAt: true,
    consultant: {
      select: {
        displayName: true,
        title: true,
        avatarUrl: true
      }
    }
  })
})

const withServer = async (
  app: Express,
  run: (baseUrl: string) => Promise<void>
): Promise<void> => {
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))

  try {
    const { port } = server.address() as AddressInfo
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
}

const createListHttpApp = () => {
  const app = express()
  const calls: unknown[] = []

  app.use(
    '/api/v1/consultations',
    createConsultationRouter({
      authVerifier: {
        getUser: async () => ({ id: auth.userId, email: auth.email })
      },
      checkout: async () => ({
        bookingId: '850e8400-e29b-41d4-a716-446655440000',
        paymentId: '950e8400-e29b-41d4-a716-446655440000',
        checkoutUrl: 'https://checkout.stripe.com/test'
      }),
      getAvailability: async () => ({
        date: '2099-07-01',
        slots: [
          { timeSlot: 'am', available: true },
          { timeSlot: 'pm', available: true }
        ]
      }),
      getMyConsultations: async ({ query }) => {
        calls.push(query)
        return { items: [] }
      },
      getBooking: async () => {
        throw new Error('Booking query is outside this test.')
      },
      rateLimit: {
        windowMs: 60_000,
        limit: 5
      }
    })
  )
  app.use(errorHandler)

  return { app, calls }
}

const createIntegratedListHttpApp = (profileExists: boolean) => {
  const app = express()

  app.use(
    '/api/v1/consultations',
    createConsultationRouter({
      authVerifier: {
        getUser: async () => ({ id: auth.userId, email: auth.email })
      },
      checkout: async () => ({
        bookingId: '850e8400-e29b-41d4-a716-446655440000',
        paymentId: '950e8400-e29b-41d4-a716-446655440000',
        checkoutUrl: 'https://checkout.stripe.com/test'
      }),
      getAvailability: async () => ({
        date: '2099-07-01',
        slots: [
          { timeSlot: 'am', available: true },
          { timeSlot: 'pm', available: true }
        ]
      }),
      getMyConsultations: createConsultationListService({
        findProfile: async () =>
          profileExists ? { id: profileId, displayName: null } : null,
        findMyBookings: async () => []
      }),
      getBooking: async () => {
        throw new Error('Booking query is outside this test.')
      },
      rateLimit: {
        windowMs: 60_000,
        limit: 5
      }
    })
  )
  app.use(errorHandler)

  return app
}

test('consultation list route is auth-gated, strict, and ordered before booking lookup', async () => {
  const { app, calls } = createListHttpApp()

  await withServer(app, async (baseUrl) => {
    const unauthenticated = await fetch(
      `${baseUrl}/api/v1/consultations/me`
    )
    assert.equal(unauthenticated.status, 401)

    assert.equal(
      (
        await fetch(`${baseUrl}/api/v1/consultations/me`, {
          headers: { authorization: 'Bearer valid-token' }
        })
      ).status,
      200
    )
    assert.equal(
      (
        await fetch(`${baseUrl}/api/v1/consultations/me?unexpected=value`, {
          headers: { authorization: 'Bearer valid-token' }
        })
      ).status,
      400
    )

    const response = await fetch(
      `${baseUrl}/api/v1/consultations/me?status=confirmed&limit=2`,
      { headers: { authorization: 'Bearer valid-token' } }
    )
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      success: true,
      data: { items: [] },
      error: null
    })
    assert.deepEqual(calls.at(-1), { status: 'confirmed', limit: 2 })
  })
})

test('consultation list route exposes service cursor and profile errors', async () => {
  const invalidCursorApp = createIntegratedListHttpApp(true)
  await withServer(invalidCursorApp, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/consultations/me?cursor=not-a-valid-cursor`,
      { headers: { authorization: 'Bearer valid-token' } }
    )
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR')
  })

  const missingProfileApp = createIntegratedListHttpApp(false)
  await withServer(missingProfileApp, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/consultations/me`, {
      headers: { authorization: 'Bearer valid-token' }
    })
    assert.equal(response.status, 404)
    assert.equal((await response.json()).error.code, 'PROFILE_NOT_FOUND')
  })
})
