import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import test from 'node:test'

import express, { type Express } from 'express'

import { AppError, errorHandler } from '../src/middleware/errorHandler.js'
import { createConsultationRouter } from '../src/modules/consultation/routes.js'
import * as consultationService from '../src/modules/consultation/service.js'

const bookingId = '850e8400-e29b-41d4-a716-446655440000'
const consultantId = '950e8400-e29b-41d4-a716-446655440000'
const auth = {
  userId: '650e8400-e29b-41d4-a716-446655440000',
  email: 'user@example.com'
}
const details = {
  profileId: auth.userId,
  booking: {
    id: bookingId,
    status: 'confirmed' as const,
    method: 'online' as const,
    consultationDate: '2099-07-01',
    timeSlot: 'am' as const,
    designField: 'Styling design',
    designFocus: 'Material palette',
    sourceImageId: 'internal-image-id',
    notes: 'Keep the room calm.',
    contactName: 'Asterism User',
    contactEmail: auth.email,
    createdAt: new Date('2099-06-01T00:00:00.000Z'),
    updatedAt: new Date('2099-06-02T00:00:00.000Z')
  },
  payment: {
    status: 'paid' as const,
    amount: 50_000,
    currency: 'TWD',
    paidAt: new Date('2099-06-02T00:00:00.000Z'),
    providerCheckoutSessionId: 'cs_secret_internal'
  },
  consultant: {
    id: consultantId,
    displayName: 'Asterism Consultant',
    title: 'Design Consultant',
    avatarUrl: 'https://example.com/avatar.png'
  }
}
const expectedResult = {
  booking: {
    id: bookingId,
    status: 'confirmed' as const,
    method: 'online' as const,
    consultationDate: '2099-07-01',
    timeSlot: 'am' as const,
    designField: 'Styling design',
    designFocus: 'Material palette',
    notes: 'Keep the room calm.',
    contactName: 'Asterism User',
    contactEmail: auth.email,
    createdAt: '2099-06-01T00:00:00.000Z',
    updatedAt: '2099-06-02T00:00:00.000Z'
  },
  payment: {
    status: 'paid' as const,
    amount: 50_000,
    currency: 'TWD' as const,
    paidAt: '2099-06-02T00:00:00.000Z'
  },
  consultant: {
    id: consultantId,
    displayName: 'Asterism Consultant',
    title: 'Design Consultant',
    avatarUrl: 'https://example.com/avatar.png'
  }
}

type QueryFactory = (repository: {
  findDetails(bookingId: string): Promise<typeof details | null>
}) => (request: {
  bookingId: string
  auth: typeof auth
}) => Promise<unknown>

const createQuery = (
  consultationService as typeof consultationService & {
    createConsultationQueryService?: QueryFactory
  }
).createConsultationQueryService

const hasError =
  (statusCode: number, code: string) =>
  (error: unknown): boolean =>
    error instanceof AppError &&
    error.statusCode === statusCode &&
    error.code === code

test('query service returns only the documented owner response', async () => {
  assert.equal(typeof createQuery, 'function')

  const query = createQuery!({
    findDetails: async () => details
  })

  assert.deepEqual(await query({ bookingId, auth }), expectedResult)
})

test('query service distinguishes missing and foreign bookings', async () => {
  assert.equal(typeof createQuery, 'function')

  const missingQuery = createQuery!({
    findDetails: async () => null
  })
  const foreignQuery = createQuery!({
    findDetails: async () => ({
      ...details,
      profileId: '550e8400-e29b-41d4-a716-446655440000'
    })
  })

  await assert.rejects(
    missingQuery({ bookingId, auth }),
    hasError(404, 'BOOKING_NOT_FOUND')
  )
  await assert.rejects(
    foreignQuery({ bookingId, auth }),
    hasError(403, 'FORBIDDEN')
  )
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

const createQueryHttpApp = () => {
  const app = express()
  const dependencies = {
    authVerifier: {
      getUser: async () => ({ id: auth.userId, email: auth.email })
    },
    checkout: async () => {
      throw new Error('Checkout is outside this test.')
    },
    getBooking: async () => expectedResult,
    rateLimit: {
      windowMs: 60_000,
      limit: 5
    }
  }

  app.use('/api/v1/consultations', createConsultationRouter(dependencies))
  app.use(errorHandler)

  return app
}

test('query route enforces auth, UUID validation, and the public response envelope', async () => {
  const app = createQueryHttpApp()

  await withServer(app, async (baseUrl) => {
    const request = (
      targetBookingId = bookingId,
      authorization = true
    ) =>
      fetch(
        `${baseUrl}/api/v1/consultations/${targetBookingId}`,
        {
          headers: authorization
            ? { authorization: 'Bearer valid-token' }
            : {}
        }
      )

    assert.equal((await request(bookingId, false)).status, 401)
    assert.equal((await request('not-a-uuid')).status, 400)

    const response = await request()
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      success: true,
      data: expectedResult,
      error: null
    })
  })
})
