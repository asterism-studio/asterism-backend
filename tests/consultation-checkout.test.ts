import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import test from 'node:test'

import express, { type Express } from 'express'

import { AppError, errorHandler } from '../src/middleware/errorHandler.js'
import { createConsultationRouter } from '../src/modules/consultation/routes.js'
import {
  createCheckoutSchema,
  idempotencyKeySchema
} from '../src/modules/consultation/schema.js'
import { createConsultationCheckoutService } from '../src/modules/consultation/service.js'
import type {
  BookingRecord,
  CheckoutCommand,
  CheckoutDependencies,
  CheckoutRecord
} from '../src/modules/consultation/types.js'
import { createPaymentCheckoutService } from '../src/modules/payments/service.js'
import type {
  PaymentRepository,
  StripeCheckoutGateway,
  StripeCheckoutSession
} from '../src/modules/payments/types.js'

const idempotencyKey = '550e8400-e29b-41d4-a716-446655440000'
const bookingId = '850e8400-e29b-41d4-a716-446655440000'
const paymentId = '750e8400-e29b-41d4-a716-446655440000'
const auth = {
  userId: '650e8400-e29b-41d4-a716-446655440000',
  email: 'user@example.com'
}
const validPayload = {
  method: 'online',
  consultationDate: '2099-07-01',
  timeSlot: 'am',
  designField: 'Styling design',
  designFocus: 'Material palette',
  sourceImageId: 'image_123',
  notes: 'I want advice for a calm living room.',
  paymentConsentAccepted: true
} as const
const validCommand: CheckoutCommand = {
  idempotencyKey,
  auth,
  input: createCheckoutSchema.parse(validPayload)
}

const rejectsWithCode = (code: string) => (error: unknown) =>
  error instanceof AppError && error.code === code

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

test('checkout schema enforces the documented trust boundary', () => {
  assert.equal(createCheckoutSchema.safeParse(validPayload).success, true)
  assert.equal(idempotencyKeySchema.safeParse(idempotencyKey).success, true)
  assert.equal(
    createCheckoutSchema.parse({ ...validPayload, method: 'in_person' }).method,
    'in_person'
  )

  for (const payload of [
    { ...validPayload, method: 'in-person' },
    { ...validPayload, amount: 500 },
    { ...validPayload, profile_id: auth.userId },
    { ...validPayload, userId: auth.userId },
    { ...validPayload, email: 'attacker@example.com' },
    { ...validPayload, consultationDate: '2099-02-30' },
    { ...validPayload, consultationDate: '2000-01-01' },
    { ...validPayload, paymentConsentAccepted: false }
  ]) {
    assert.equal(createCheckoutSchema.safeParse(payload).success, false)
  }
})

const createServiceFixture = (
  overrides: {
    existing?: CheckoutRecord | null
    profile?: { id: string; displayName: string | null } | null
    sourceImageExists?: boolean
    slotUnavailable?: boolean
  } = {}
) => {
  const calls = {
    createCheckoutDraft: 0,
    createOrResume: 0,
    findCheckout: [] as string[]
  }
  const booking: BookingRecord = {
    id: bookingId,
    profileId: auth.userId,
    method: 'online',
    consultationDate: '2099-07-01',
    timeSlot: 'am',
    designField: 'Styling design',
    designFocus: 'Material palette',
    sourceImageId: 'image_123',
    notes: 'I want advice for a calm living room.',
    contactName: 'Asterism User',
    contactEmail: auth.email,
    status: 'pending_payment'
  }
  const payment = {
    id: paymentId,
    bookingId,
    providerCheckoutSessionId: null
  }
  const dependencies: CheckoutDependencies = {
    consultations: {
      findDetails: async () => null,
      findMyBookings: async () => [],
      findOccupiedSlots: async () => [],
      findOccupiedSlotsInRange: async () => [],
      findCheckout: async (profileId, key) => {
        calls.findCheckout = [profileId, key]
        return overrides.existing ?? null
      },
      findProfile: async () =>
        overrides.profile === undefined
          ? { id: auth.userId, displayName: 'Asterism User' }
          : overrides.profile,
      sourceImageExists: async () => overrides.sourceImageExists ?? true,
      createCheckoutDraft: async () => {
        calls.createCheckoutDraft += 1
        return overrides.slotUnavailable ? null : { booking, payment }
      }
    },
    payments: {
      prepareCheckout: async () => ({
        stripePriceId: 'price_consultation',
        amount: 50_000,
        currency: 'TWD'
      }),
      createOrResume: async ({ booking: targetBooking }) => {
        calls.createOrResume += 1
        return {
          bookingId: targetBooking.id,
          paymentId,
          checkoutUrl: 'https://checkout.stripe.com/c/pay/test'
        }
      }
    },
    now: () => new Date('2099-06-01T00:00:00.000Z')
  }

  return {
    checkout: createConsultationCheckoutService(dependencies),
    booking,
    payment,
    calls
  }
}

test('checkout service creates once and safely resumes the same intent', async () => {
  const first = createServiceFixture()
  const created = await first.checkout(validCommand)
  const retry = createServiceFixture({
    existing: { booking: first.booking, payment: first.payment }
  })
  const resumed = await retry.checkout(validCommand)

  assert.deepEqual(created, resumed)
  assert.equal(created.bookingId, bookingId)
  assert.notEqual(created.bookingId, idempotencyKey)
  assert.deepEqual(first.calls.findCheckout, [auth.userId, idempotencyKey])
  assert.equal(first.calls.createCheckoutDraft, 1)
  assert.equal(retry.calls.createCheckoutDraft, 1)
  assert.equal(retry.calls.createOrResume, 1)
})

test('checkout service rejects authenticated accounts without email', async () => {
  const fixture = createServiceFixture()
  const command = {
    ...validCommand,
    auth: {
      userId: auth.userId,
      email: null
    }
  }

  await assert.rejects(
    fixture.checkout(command),
    rejectsWithCode('PROFILE_EMAIL_REQUIRED')
  )
  assert.equal(fixture.calls.createCheckoutDraft, 0)
})

test('checkout service rejects reused keys and unavailable resources', async () => {
  const base = createServiceFixture()
  const cases = [
    {
      fixture: createServiceFixture({
        existing: {
          booking: { ...base.booking, designFocus: 'Different request' },
          payment: null
        }
      }),
      code: 'IDEMPOTENCY_KEY_REUSED',
      createCheckoutDraft: 0
    },
    {
      fixture: createServiceFixture({ profile: null }),
      code: 'PROFILE_NOT_FOUND',
      createCheckoutDraft: 0
    },
    {
      fixture: createServiceFixture({ sourceImageExists: false }),
      code: 'SOURCE_IMAGE_NOT_FOUND',
      createCheckoutDraft: 0
    },
    {
      fixture: createServiceFixture({ slotUnavailable: true }),
      code: 'SLOT_UNAVAILABLE',
      createCheckoutDraft: 1
    }
  ]

  for (const { fixture, code, createCheckoutDraft } of cases) {
    await assert.rejects(fixture.checkout(validCommand), rejectsWithCode(code))
    assert.equal(fixture.calls.createCheckoutDraft, createCheckoutDraft)
  }
})

const createPaymentFixture = (
  options: {
    priceCurrency?: string
    unitAmount?: number
    sessionStatus?: StripeCheckoutSession['status']
    existingPayment?: CheckoutRecord['payment']
    providerFailure?: boolean
  } = {}
) => {
  const calls = {
    idempotencyKey: '',
    customerEmail: '',
    createSession: 0,
    attachSession: 0,
    markFailed: 0,
    failureReason: ''
  }
  const session: StripeCheckoutSession = {
    id: 'cs_test_123',
    status: options.sessionStatus ?? 'open',
    url:
      options.sessionStatus === 'expired'
        ? null
        : 'https://checkout.stripe.com/c/pay/test',
    expiresAt: new Date('2099-07-01T01:00:00.000Z')
  }
  const stripe: StripeCheckoutGateway = {
    retrievePrice: async () => ({
      id: 'price_consultation',
      active: true,
      currency: options.priceCurrency ?? 'twd',
      unitAmount: options.unitAmount ?? 50_000
    }),
    createSession: async (input, stripeIdempotencyKey) => {
      if (options.providerFailure) {
        throw new Error('Stripe unavailable')
      }
      calls.idempotencyKey = stripeIdempotencyKey
      calls.customerEmail = input.customerEmail
      calls.createSession += 1
      return session
    },
    retrieveSession: async () => session
  }
  const payments: PaymentRepository = {
    attachSession: async (input) => {
      calls.attachSession += 1
      return {
        id: input.paymentId,
        bookingId,
        providerCheckoutSessionId: input.providerCheckoutSessionId
      }
    },
    markFailed: async (_paymentId, failureReason) => {
      calls.markFailed += 1
      calls.failureReason = failureReason
    }
  }
  const service = createPaymentCheckoutService({
    stripe,
    payments,
    stripePriceId: 'price_consultation',
    successUrl: 'http://localhost:5173/consultant?payment=success',
    cancelUrl: 'http://localhost:5173/consultant?payment=cancel',
    now: () => new Date('2099-06-01T00:00:00.000Z')
  })

  return {
    service,
    booking: createServiceFixture().booking,
    payment:
      options.existingPayment ?? {
        id: paymentId,
        bookingId,
        providerCheckoutSessionId: null
      },
    calls
  }
}

test('payment service creates a stable Stripe checkout from booking data', async () => {
  const { service, booking, payment, calls } = createPaymentFixture()
  const price = await service.prepareCheckout()
  const result = await service.createOrResume({
    booking,
    payment,
    price
  })

  assert.equal(result.bookingId, booking.id)
  assert.equal(
    calls.idempotencyKey,
    `consultation-checkout:${bookingId}`
  )
  assert.equal(calls.customerEmail, booking.contactEmail)
  assert.equal(calls.createSession, 1)
  assert.equal(calls.attachSession, 1)
})

test('payment service records provider failure on the existing draft', async () => {
  const { service, booking, payment, calls } = createPaymentFixture({
    providerFailure: true
  })

  await assert.rejects(
    service.createOrResume({
      booking,
      payment,
      price: await service.prepareCheckout()
    }),
    rejectsWithCode('CHECKOUT_PROVIDER_ERROR')
  )

  assert.equal(calls.markFailed, 1)
  assert.equal(
    calls.failureReason,
    'Stripe Checkout Session creation failed.'
  )
})

test('payment service rejects bad configuration and unusable sessions', async () => {
  const badPrice = createPaymentFixture({ priceCurrency: 'usd' })
  await assert.rejects(
    badPrice.service.prepareCheckout(),
    rejectsWithCode('CHECKOUT_CONFIGURATION_ERROR')
  )
  await assert.rejects(
    createPaymentFixture({ unitAmount: 99_900 }).service.prepareCheckout(),
    rejectsWithCode('CHECKOUT_CONFIGURATION_ERROR')
  )

  const payment = {
    id: paymentId,
    bookingId,
    providerCheckoutSessionId: 'cs_expired'
  }
  const expired = createPaymentFixture({
    existingPayment: payment,
    sessionStatus: 'expired'
  })
  await assert.rejects(
    expired.service.createOrResume({
      booking: expired.booking,
      payment
    }),
    rejectsWithCode('CHECKOUT_EXPIRED')
  )
})

const createCheckoutHttpApp = (options: {
  rateLimit?: number
}) => {
  const app = express()
  const router = createConsultationRouter({
    authVerifier: {
      getUser: async () => ({ id: auth.userId, email: auth.email })
    },
    checkout: async (command) => ({
      bookingId: command.idempotencyKey,
      paymentId: '750e8400-e29b-41d4-a716-446655440000',
      checkoutUrl: 'https://checkout.stripe.com/c/pay/test'
    }),
    getAvailability: async () => {
      throw new Error('Availability is outside this test.')
    },
    getMyConsultations: async () => ({ items: [] }),
    getBooking: async () => {
      throw new Error('Booking query is outside this test.')
    },
    rateLimit: {
      windowMs: 60_000,
      limit: options.rateLimit ?? 5
    }
  })

  app.use(express.json())
  app.use('/api/v1/consultations', router)
  app.use(errorHandler)

  return app
}

const postCheckout = (
  baseUrl: string,
  options: {
    authorization?: boolean
    idempotencyKey?: string
  } = {}
) =>
  fetch(`${baseUrl}/api/v1/consultations/checkout`, {
    method: 'POST',
    headers: {
      ...(options.authorization === false
        ? {}
        : { authorization: 'Bearer valid-token' }),
      ...(options.idempotencyKey
        ? { 'idempotency-key': options.idempotencyKey }
        : {}),
      'content-type': 'application/json'
    },
    body: JSON.stringify(validPayload)
  })

test('checkout route enforces auth and idempotency before returning 201', async () => {
  const app = createCheckoutHttpApp({})

  await withServer(app, async (baseUrl) => {
    assert.equal(
      (await postCheckout(baseUrl, { authorization: false })).status,
      401
    )
    assert.equal((await postCheckout(baseUrl)).status, 400)

    const response = await postCheckout(baseUrl, { idempotencyKey })
    const body = (await response.json()) as {
      success: boolean
      data: Record<string, string>
      error: null
    }

    assert.equal(response.status, 201)
    assert.equal(body.success, true)
    assert.equal(body.error, null)
    assert.deepEqual(Object.keys(body.data).sort(), [
      'bookingId',
      'checkoutUrl',
      'paymentId'
    ])
  })
})

test('checkout route rate limits authenticated users', async () => {
  const limited = createCheckoutHttpApp({ rateLimit: 1 })
  await withServer(limited, async (baseUrl) => {
    assert.equal(
      (await postCheckout(baseUrl, { idempotencyKey })).status,
      201
    )
    assert.equal(
      (await postCheckout(baseUrl, { idempotencyKey })).status,
      429
    )
  })
})
