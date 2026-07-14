import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import test from 'node:test'

import express, { type Express } from 'express'

import { errorHandler } from '../src/middleware/errorHandler.js'
import {
  createConsultationRepository,
  occupiedSlotWhere
} from '../src/modules/consultation/repository.js'
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
const monthResult = {
  month: '2099-07',
  startDate: '2099-07-01',
  endDate: '2099-07-31',
  days: [
    {
      date: '2099-07-01',
      slots: [
        { timeSlot: 'am' as const, available: true },
        { timeSlot: 'pm' as const, available: false }
      ]
    },
    {
      date: '2099-07-02',
      slots: [
        { timeSlot: 'am' as const, available: false },
        { timeSlot: 'pm' as const, available: true }
      ]
    }
  ]
}
const monthEndDates = {
  '2099-04': '2099-04-30',
  '2099-07': '2099-07-31',
  '2100-02': '2100-02-28',
  '2104-02': '2104-02-29'
} as const
const now = new Date('2099-06-01T00:00:00.000Z')

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
      },
      findOccupiedSlotsInRange: async () => {
        throw new Error('Range lookup is outside this test.')
      }
    },
    now: () => new Date('2099-06-01T00:00:00.000Z')
  })

  assert.deepEqual(
    await availability({ date: '2099-07-01', auth }),
    availableResult
  )
})

test('availability service returns all days in a requested month', async () => {
  const availability = createConsultationAvailabilityService({
    consultations: {
      findOccupiedSlots: async () => {
        throw new Error('Single-day lookup is outside this test.')
      },
      findOccupiedSlotsInRange: async (startDate, endDate, now) => {
        assert.equal(startDate, '2099-07-01')
        assert.equal(endDate, '2099-07-31')
        assert.equal(now.toISOString(), '2099-06-01T00:00:00.000Z')
        return [
          { date: '2099-07-01', timeSlot: 'pm' },
          { date: '2099-07-02', timeSlot: 'am' }
        ]
      }
    },
    now: () => new Date('2099-06-01T00:00:00.000Z')
  })

  const result = await availability({ month: '2099-07', auth })

  assert.ok('days' in result)
  assert.equal(result.month, '2099-07')
  assert.equal(result.startDate, '2099-07-01')
  assert.equal(result.endDate, '2099-07-31')
  assert.equal(result.days.length, 31)
  assert.deepEqual(result.days.slice(0, 2), monthResult.days)
  assert.deepEqual(result.days.at(-1), {
    date: '2099-07-31',
    slots: [
      { timeSlot: 'am' as const, available: true },
      { timeSlot: 'pm' as const, available: true }
    ]
  })
})

test('availability service marks past days unavailable in the current month', async () => {
  const availability = createConsultationAvailabilityService({
    consultations: {
      findOccupiedSlots: async () => {
        throw new Error('Single-day lookup is outside this test.')
      },
      findOccupiedSlotsInRange: async () => []
    },
    now: () => new Date('2099-07-09T00:00:00.000Z')
  })

  const result = await availability({ month: '2099-07', auth })

  assert.ok('days' in result)
  assert.deepEqual(result.days[0], {
    date: '2099-07-01',
    slots: [
      { timeSlot: 'am' as const, available: false },
      { timeSlot: 'pm' as const, available: false }
    ]
  })
  assert.deepEqual(result.days[8], {
    date: '2099-07-09',
    slots: [
      { timeSlot: 'am' as const, available: true },
      { timeSlot: 'pm' as const, available: true }
    ]
  })
})

test('occupied slot rule matches checkout and availability requirements', () => {
  assert.deepEqual(occupiedSlotWhere(now), {
    OR: [
      { status: { in: ['confirmed', 'completed'] } },
      {
        status: 'pending_payment',
        payment: {
          is: { checkoutExpiresAt: { gt: now } }
        }
      }
    ]
  })
})

test('availability repository queries distinct occupied slots for the requested date', async () => {
  let findManyInput: unknown
  const repository = createConsultationRepository({
    consultationBooking: {
      findMany: async (input: unknown) => {
        findManyInput = input
        return [{ timeSlot: 'am' }, { timeSlot: 'pm' }]
      }
    }
  } as Parameters<typeof createConsultationRepository>[0])

  assert.deepEqual(
    await repository.findOccupiedSlots('2099-07-01', now),
    ['am', 'pm']
  )
  assert.deepEqual(findManyInput, {
    where: {
      consultationDate: new Date('2099-07-01T00:00:00.000Z'),
      ...occupiedSlotWhere(now)
    },
    select: { timeSlot: true },
    distinct: ['timeSlot']
  })
})

test('availability repository queries distinct occupied slots for the requested month range', async () => {
  let findManyInput: unknown
  const repository = createConsultationRepository({
    consultationBooking: {
      findMany: async (input: unknown) => {
        findManyInput = input
        return [
          {
            consultationDate: new Date('2099-07-01T00:00:00.000Z'),
            timeSlot: 'pm'
          },
          {
            consultationDate: new Date('2099-07-02T00:00:00.000Z'),
            timeSlot: 'am'
          }
        ]
      }
    }
  } as Parameters<typeof createConsultationRepository>[0])

  assert.deepEqual(
    await repository.findOccupiedSlotsInRange(
      '2099-07-01',
      '2099-07-31',
      now
    ),
    [
      { date: '2099-07-01', timeSlot: 'pm' },
      { date: '2099-07-02', timeSlot: 'am' }
    ]
  )
  assert.deepEqual(findManyInput, {
    where: {
      consultationDate: {
        gte: new Date('2099-07-01T00:00:00.000Z'),
        lte: new Date('2099-07-31T00:00:00.000Z')
      },
      ...occupiedSlotWhere(now)
    },
    select: { consultationDate: true, timeSlot: true },
    distinct: ['consultationDate', 'timeSlot']
  })
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
    getAvailability: async (request) =>
      'date' in request
        ? { ...availableResult, date: request.date }
        : {
            ...monthResult,
            month: request.month,
            startDate: `${request.month}-01`,
            endDate:
              monthEndDates[request.month as keyof typeof monthEndDates]
          },
    getMyConsultations: async () => ({ items: [] }),
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
    const getAvailabilityByQuery = (query: string) =>
      fetch(
        `${baseUrl}/api/v1/consultations/availability?${query}`,
        { headers: { authorization: 'Bearer valid-token' } }
      )

    assert.equal((await getAvailability('2099-07-01', false)).status, 401)
    assert.equal((await getAvailability('2099-02-30')).status, 400)
    assert.equal((await getAvailability('2000-01-01')).status, 400)
    assert.equal((await getAvailabilityByQuery('month=2099-13')).status, 400)
    assert.equal((await getAvailabilityByQuery('')).status, 400)
    assert.equal(
      (await getAvailabilityByQuery('date=2099-07-01&month=2099-07')).status,
      400
    )
    assert.equal(
      (await getAvailabilityByQuery('month=2099-07&startDate=2099-07-01'))
        .status,
      400
    )

    const response = await getAvailability('2099-07-01')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      success: true,
      data: availableResult,
      error: null
    })

    const monthResponse = await getAvailabilityByQuery('month=2099-07')
    assert.equal(monthResponse.status, 200)
    assert.deepEqual(await monthResponse.json(), {
      success: true,
      data: monthResult,
      error: null
    })

    for (const [month, expectedEndDate] of [
      ['2099-04', '2099-04-30'],
      ['2100-02', '2100-02-28'],
      ['2104-02', '2104-02-29']
    ] as const) {
      const monthCheck = await getAvailabilityByQuery(`month=${month}`)
      assert.equal(monthCheck.status, 200)
      const body = await monthCheck.json()
      assert.equal(body.data.month, month)
      assert.equal(body.data.endDate, expectedEndDate)
    }

    const bookingResponse = await fetch(
      `${baseUrl}/api/v1/consultations/${bookingId}`,
      { headers: { authorization: 'Bearer valid-token' } }
    )
    assert.equal(bookingResponse.status, 200)
  })
})
