import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import test from 'node:test'

import express, { type Express } from 'express'
import Stripe from 'stripe'

import {
  AppError,
  errorHandler
} from '../src/middleware/errorHandler.js'
import { createStripeWebhookRepository } from '../src/modules/payments/repository.js'
import { createStripeWebhookRouter } from '../src/modules/payments/routes.js'
import { createStripeWebhookService } from '../src/modules/payments/webhook-service.js'
import type {
  ProcessStripeEventInput,
  StripeWebhookRepository
} from '../src/modules/payments/types.js'

const event = (
  id: string,
  type: Stripe.Event['type'],
  sessionId = 'cs_test_123'
): Stripe.Event =>
  ({
    id,
    type,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        payment_intent: 'pi_test_123'
      }
    }
  }) as Stripe.Event

const createServiceFixture = (options: {
  duplicate?: boolean
  recordFailure?: boolean
  processingFailure?: boolean
} = {}) => {
  const processed: ProcessStripeEventInput[] = []
  const errors: Array<{ stripeEventId: string; reason: string }> = []
  const repository: StripeWebhookRepository = {
    recordOrResumeEvent: async () => {
      if (options.recordFailure) {
        throw new Error('event insert unavailable')
      }

      return !options.duplicate
    },
    processEvent: async (input) => {
      if (options.processingFailure) {
        throw new Error('database unavailable')
      }

      processed.push(input)
    },
    recordProcessingError: async (stripeEventId, reason) => {
      errors.push({ stripeEventId, reason })
    }
  }
  const handleWebhook = createStripeWebhookService({
    repository,
    now: () => new Date('2026-07-02T00:00:00.000Z')
  })

  return { handleWebhook, processed, errors }
}

test('completed and expired events produce only their expected transitions', async () => {
  const fixture = createServiceFixture()

  await fixture.handleWebhook(
    event('evt_completed', 'checkout.session.completed'),
    { id: 'evt_completed' }
  )
  await fixture.handleWebhook(
    event('evt_expired', 'checkout.session.expired'),
    { id: 'evt_expired' }
  )

  assert.deepEqual(
    fixture.processed.map(
      ({ stripeEventId, transition, sessionId, paymentIntentId }) => ({
        stripeEventId,
        transition,
        sessionId,
        paymentIntentId
      })
    ),
    [
      {
        stripeEventId: 'evt_completed',
        transition: 'completed',
        sessionId: 'cs_test_123',
        paymentIntentId: 'pi_test_123'
      },
      {
        stripeEventId: 'evt_expired',
        transition: 'expired',
        sessionId: 'cs_test_123',
        paymentIntentId: 'pi_test_123'
      }
    ]
  )
})

test('duplicate and unsupported events are safe no-ops', async () => {
  const duplicate = createServiceFixture({ duplicate: true })
  await duplicate.handleWebhook(
    event('evt_duplicate', 'checkout.session.completed'),
    { id: 'evt_duplicate' }
  )
  assert.equal(duplicate.processed.length, 0)

  const unsupported = createServiceFixture()
  await unsupported.handleWebhook(
    event('evt_unsupported', 'customer.created'),
    { id: 'evt_unsupported' }
  )
  assert.equal(unsupported.processed[0]?.transition, null)
  assert.equal(unsupported.processed[0]?.sessionId, null)
})

test('processing failures remain retry-visible and return the documented error', async () => {
  const fixture = createServiceFixture({ processingFailure: true })

  await assert.rejects(
    fixture.handleWebhook(
      event('evt_failed', 'checkout.session.completed'),
      { id: 'evt_failed' }
    ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 500 &&
      error.code === 'WEBHOOK_PROCESSING_FAILED'
  )
  assert.deepEqual(fixture.errors, [
    {
      stripeEventId: 'evt_failed',
      reason: 'database unavailable'
    }
  ])
})

test('event recording failures return the documented processing error', async () => {
  const fixture = createServiceFixture({ recordFailure: true })

  await assert.rejects(
    fixture.handleWebhook(
      event('evt_record_failed', 'checkout.session.completed'),
      { id: 'evt_record_failed' }
    ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 500 &&
      error.code === 'WEBHOOK_PROCESSING_FAILED'
  )
})

const createDatabaseFixture = (
  paymentStatus:
    | 'pending'
    | 'paid'
    | 'failed'
    | 'canceled'
    | 'refunded' = 'pending',
  bookingStatus:
    | 'pending_payment'
    | 'confirmed'
    | 'payment_failed'
    | 'canceled'
    | 'completed' = 'pending_payment'
) => {
  const state = {
    payment: {
      id: 'payment_123',
      bookingId: 'booking_123',
      providerCheckoutSessionId: 'cs_test_123',
      providerPaymentIntentId: null as string | null,
      status: paymentStatus,
      paidAt: null as Date | null,
      canceledAt: null as Date | null,
      booking: {
        id: 'booking_123',
        status: bookingStatus
      }
    },
    event: {
      stripeEventId: 'evt_test',
      processedAt: null as Date | null,
      processingError: null as string | null
    },
    eventExists: false
  }
  const database = {
    stripeWebhookEvent: {
      createMany: async () => {
        if (state.eventExists) {
          return { count: 0 }
        }

        state.eventExists = true
        return { count: 1 }
      },
      findUnique: async () => state.event,
      update: async ({ data }: { data: Partial<typeof state.event> }) => {
        Object.assign(state.event, data)
        return state.event
      }
    },
    consultationPayment: {
      findUnique: async ({
        where
      }: {
        where: { providerCheckoutSessionId: string }
      }) =>
        where.providerCheckoutSessionId ===
        state.payment.providerCheckoutSessionId
          ? state.payment
          : null,
      updateMany: async ({
        where,
        data
      }: {
        where: { id: string; status: string }
        data: Partial<typeof state.payment>
      }) => {
        if (
          where.id !== state.payment.id ||
          where.status !== state.payment.status
        ) {
          return { count: 0 }
        }

        Object.assign(state.payment, data)
        return { count: 1 }
      }
    },
    consultationBooking: {
      updateMany: async ({
        where,
        data
      }: {
        where: { id: string; status: string }
        data: Partial<typeof state.payment.booking>
      }) => {
        if (
          where.id !== state.payment.booking.id ||
          where.status !== state.payment.booking.status
        ) {
          return { count: 0 }
        }

        Object.assign(state.payment.booking, data)
        return { count: 1 }
      }
    },
    $transaction: async <T>(run: (transaction: unknown) => Promise<T>) =>
      run(database)
  }

  return {
    repository: createStripeWebhookRepository(database as never),
    state
  }
}

test('repository atomically applies completed and expired transitions', async () => {
  for (const expected of [
    {
      transition: 'completed' as const,
      paymentStatus: 'paid',
      bookingStatus: 'confirmed'
    },
    {
      transition: 'expired' as const,
      paymentStatus: 'canceled',
      bookingStatus: 'canceled'
    }
  ]) {
    const { repository, state } = createDatabaseFixture()
    await repository.processEvent({
      stripeEventId: 'evt_test',
      eventType: `checkout.session.${expected.transition}`,
      transition: expected.transition,
      sessionId: 'cs_test_123',
      paymentIntentId: 'pi_test_123',
      processedAt: new Date('2026-07-02T00:00:00.000Z')
    })

    assert.equal(state.payment.status, expected.paymentStatus)
    assert.equal(state.payment.booking.status, expected.bookingStatus)
    assert.equal(
      state.event.processedAt?.toISOString(),
      '2026-07-02T00:00:00.000Z'
    )
    assert.equal(state.event.processingError, null)
  }
})

test('repository records unknown payments and state conflicts without mutation', async () => {
  const unknown = createDatabaseFixture()
  await unknown.repository.processEvent({
    stripeEventId: 'evt_test',
    eventType: 'checkout.session.completed',
    transition: 'completed',
    sessionId: 'cs_unknown',
    paymentIntentId: 'pi_test_123',
    processedAt: new Date('2026-07-02T00:00:00.000Z')
  })
  assert.match(
    unknown.state.event.processingError ?? '',
    /Payment not found/
  )
  assert.equal(unknown.state.payment.status, 'pending')

  const conflict = createDatabaseFixture('canceled', 'canceled')
  await conflict.repository.processEvent({
    stripeEventId: 'evt_test',
    eventType: 'checkout.session.completed',
    transition: 'completed',
    sessionId: 'cs_test_123',
    paymentIntentId: 'pi_test_123',
    processedAt: new Date('2026-07-02T00:00:00.000Z')
  })
  assert.match(
    conflict.state.event.processingError ?? '',
    /Status conflict/
  )
  assert.equal(conflict.state.payment.status, 'canceled')
  assert.equal(conflict.state.payment.booking.status, 'canceled')
  assert.ok(conflict.state.event.processedAt)
})

test('repository retries unprocessed duplicates and ignores processed duplicates', async () => {
  const { repository, state } = createDatabaseFixture()
  const input = {
    stripeEventId: 'evt_test',
    eventType: 'checkout.session.completed',
    payload: { id: 'evt_test' }
  }

  assert.equal(await repository.recordOrResumeEvent(input), true)
  assert.equal(await repository.recordOrResumeEvent(input), true)

  state.event.processedAt = new Date('2026-07-02T00:00:00.000Z')
  assert.equal(await repository.recordOrResumeEvent(input), false)
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

test('webhook route verifies the raw Stripe payload before handling it', async () => {
  const stripe = new Stripe('sk_test_webhook')
  const webhookSecret = 'whsec_test'
  const payload = JSON.stringify({
    id: 'evt_route',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_route',
        object: 'checkout.session',
        payment_intent: 'pi_route'
      }
    }
  })
  const handled: Array<{ eventId: string; payload: unknown }> = []
  const app = express()
  app.use(
    '/api/v1/payments/stripe/webhook',
    createStripeWebhookRouter({
      stripe,
      webhookSecret,
      handleWebhook: async (stripeEvent, rawPayload) => {
        handled.push({ eventId: stripeEvent.id, payload: rawPayload })
      }
    })
  )
  app.use(errorHandler)

  await withServer(app, async (baseUrl) => {
    const invalid = await fetch(
      `${baseUrl}/api/v1/payments/stripe/webhook`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 'invalid'
        },
        body: payload
      }
    )
    assert.equal(invalid.status, 400)
    assert.equal(
      ((await invalid.json()) as { error: { code: string } }).error.code,
      'INVALID_STRIPE_SIGNATURE'
    )
    assert.equal(handled.length, 0)

    const valid = await fetch(
      `${baseUrl}/api/v1/payments/stripe/webhook`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature':
            stripe.webhooks.generateTestHeaderString({
              payload,
              secret: webhookSecret
            })
        },
        body: payload
      }
    )
    assert.equal(valid.status, 200)
    assert.deepEqual(await valid.json(), { received: true })
    assert.deepEqual(handled, [
      {
        eventId: 'evt_route',
        payload: JSON.parse(payload)
      }
    ])
  })
})
