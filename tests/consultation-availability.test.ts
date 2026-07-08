import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import test from 'node:test'

import express, { type Express } from 'express'

import { errorHandler } from '../src/middleware/errorHandler.js'
import { createConsultationRouter } from '../src/modules/consultation/routes.js'
import { createConsultationAvailabilityService } from '../src/modules/consultation/service.js'

const auth = {
  userId: '650e8400-e29b-41d4-a716-446655440000',
  email: 'user@example.com'
}
const bookingId = '850e8400-e29b-41d4-a716-446655440000'
const availableResult = {
  date: '2099-07-01',
  slots: [
    { timeSlot: 'am' as const, available: true },
    { timeSlot: 'pm' as const, available: false }
  ]
}

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

test('availability service returns fixed am and pm slots with occupied slots unavailable', async () => {
  const availability = createConsultationAvailabilityService({
    consultations: {
      findOccupiedSlots: async (date, now) => {
        assert.equal(date, '2099-07-01')
        assert.equal(now.toISOString(), '2099-06-01T00:00:00.000Z')
        return ['pm']
      }
    },
    now: () => new Date('2099-06-01T00:00:00.000Z')
  })

  assert.deepEqual(
    await availability({ date: '2099-07-01', auth }),
    availableResult
  )
})

const createAvailabilityHttpApp = () => {
  const app = express()
  const router = createConsultationRouter({
    authVerifier: {
      getUser: async () => ({ id: auth.userId, email: auth.email })
    },
    checkout: async () => {
      throw new Error('Checkout is outside this test.')
    },
    getAvailability: async ({ date }) => ({
      ...availableResult,
      date
    }),
    getBooking: async ({ bookingId: requestedBookingId }) => ({
      booking: {
        id: requestedBookingId,
        status: 'confirmed' as const,
        method: 'online' as const,
        consultationDate: '2099-07-01',
        timeSlot: 'am' as const,
        contactEmail: auth.email,
        createdAt: '2099-06-01T00:00:00.000Z',
        updatedAt: '2099-06-02T00:00:00.000Z'
      },
      payment: {
        status: 'paid' as const,
        amount: 50_000,
        currency: 'TWD' as const
      }
    }),
    rateLimit: {
      windowMs: 60_000,
      limit: 5
    }
  })

  app.use('/api/v1/consultations', router)
  app.use(errorHandler)

  return app
}

test('availability route enforces auth, date validation, and does not shadow booking lookup', async () => {
  const app = createAvailabilityHttpApp()

  await withServer(app, async (baseUrl) => {
    const getAvailability = (date: string, authorization = true) =>
      fetch(
        `${baseUrl}/api/v1/consultations/availability?date=${date}`,
        {
          headers: authorization
            ? { authorization: 'Bearer valid-token' }
            : {}
        }
      )

    assert.equal((await getAvailability('2099-07-01', false)).status, 401)
    assert.equal((await getAvailability('2099-02-30')).status, 400)
    assert.equal((await getAvailability('2000-01-01')).status, 400)

    const response = await getAvailability('2099-07-01')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      success: true,
      data: availableResult,
      error: null
    })

    const bookingResponse = await fetch(
      `${baseUrl}/api/v1/consultations/${bookingId}`,
      { headers: { authorization: 'Bearer valid-token' } }
    )
    assert.equal(bookingResponse.status, 200)
  })
})
