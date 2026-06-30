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

  for (const payload of [
    { ...validPayload, amount: 500 },
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
  const calls = { createBooking: 0, createOrResume: 0 }
  const booking: BookingRecord = {
    id: idempotencyKey,
    profileId: auth.userId,
    method: 'online',
    consultationDate: '2099-07-01',
    timeSlot: 'am',
    designField: 'Styling design',
    designFocus: 'Material palette',
    sourceImageId: 'image_123',
    notes: 'I want advice for a calm living room.',
    contactEmail: auth.email,
    status: 'pending_payment'
  }
  const dependencies: CheckoutDependencies = {
    consultations: {
      findCheckout: async () => overrides.existing ?? null,
      findProfile: async () =>
        overrides.profile === undefined
          ? { id: auth.userId, displayName: 'Asterism User' }
          : overrides.profile,
      sourceImageExists: async () => overrides.sourceImageExists ?? true,
      isSlotUnavailable: async () => overrides.slotUnavailable ?? false,
      createBooking: async () => {
        calls.createBooking += 1
        return booking
      }
    },
    payments: {
      prepareCheckout: async () => ({
        stripePriceId: 'price_consultation',
        amount: 500,
        currency: 'TWD'
      }),
      createOrResume: async ({ booking: targetBooking }) => {
        calls.createOrResume += 1
        return {
          bookingId: targetBooking.id,
          paymentId: '750e8400-e29b-41d4-a716-446655440000',
          checkoutUrl: 'https://checkout.stripe.com/c/pay/test'
        }
      }
    },
    now: () => new Date('2099-06-01T00:00:00.000Z')
  }

  return {
    checkout: createConsultationCheckoutService(dependencies),
    booking,
    calls
  }
}

test('checkout service creates once and safely resumes the same intent', async () => {
  const first = createServiceFixture()
  const created = await first.checkout(validCommand)
  const retry = createServiceFixture({
    existing: { booking: first.booking, payment: null }
  })
  const resumed = await retry.checkout(validCommand)

  assert.deepEqual(created, resumed)
  assert.equal(first.calls.createBooking, 1)
  assert.equal(retry.calls.createBooking, 0)
  assert.equal(retry.calls.createOrResume, 1)
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
      code: 'IDEMPOTENCY_KEY_REUSED'
    },
    {
      fixture: createServiceFixture({ profile: null }),
      code: 'PROFILE_NOT_FOUND'
    },
    {
      fixture: createServiceFixture({ sourceImageExists: false }),
      code: 'SOURCE_IMAGE_NOT_FOUND'
    },
    {
      fixture: createServiceFixture({ slotUnavailable: true }),
      code: 'SLOT_UNAVAILABLE'
    }
  ]

  for (const { fixture, code } of cases) {
    await assert.rejects(fixture.checkout(validCommand), rejectsWithCode(code))
    assert.equal(fixture.calls.createBooking, 0)
  }
})

const createPaymentFixture = (
  options: {
    priceCurrency?: string
    sessionStatus?: StripeCheckoutSession['status']
    existingPayment?: CheckoutRecord['payment']
  } = {}
) => {
  const calls = { idempotencyKey: '', customerEmail: '', createSession: 0 }
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
      unitAmount: 500
    }),
    createSession: async (input, stripeIdempotencyKey) => {
      calls.idempotencyKey = stripeIdempotencyKey
      calls.customerEmail = input.customerEmail
      calls.createSession += 1
      return session
    },
    retrieveSession: async () => session
  }
  const payments: PaymentRepository = {
    createOrGet: async (input) =>
      options.existingPayment ?? {
        id: '750e8400-e29b-41d4-a716-446655440000',
        bookingId: input.bookingId,
        providerCheckoutSessionId: input.providerCheckoutSessionId
      }
  }
  const service = createPaymentCheckoutService({
    stripe,
    payments,
    stripePriceId: 'price_consultation',
    successUrl: 'http://localhost:5173/consultant?payment=success',
    cancelUrl: 'http://localhost:5173/consultant?payment=cancel'
  })

  return { service, booking: createServiceFixture().booking, calls }
}

test('payment service creates a stable Stripe checkout from booking data', async () => {
  const { service, booking, calls } = createPaymentFixture()
  const price = await service.prepareCheckout()
  const result = await service.createOrResume({
    booking,
    payment: null,
    price
  })

  assert.equal(result.bookingId, booking.id)
  assert.equal(
    calls.idempotencyKey,
    `consultation-checkout:${idempotencyKey}`
  )
  assert.equal(calls.customerEmail, booking.contactEmail)
  assert.equal(calls.createSession, 1)
})

test('payment service rejects bad configuration and unusable sessions', async () => {
  const badPrice = createPaymentFixture({ priceCurrency: 'usd' })
  await assert.rejects(
    badPrice.service.prepareCheckout(),
    rejectsWithCode('CHECKOUT_CONFIGURATION_ERROR')
  )

  const payment = {
    id: '750e8400-e29b-41d4-a716-446655440000',
    bookingId: idempotencyKey,
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
