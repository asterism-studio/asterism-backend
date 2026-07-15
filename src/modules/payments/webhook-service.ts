import type Stripe from 'stripe'

import { AppError } from '../../middleware/errorHandler.js'
import type {
  CreateStripeWebhookDependencies,
  ProcessStripeEventInput,
  StripeWebhookHandler
} from './types.js'

const paymentIntentId = (
  paymentIntent: string | Stripe.PaymentIntent | null
): string | null =>
  typeof paymentIntent === 'string'
    ? paymentIntent
    : paymentIntent?.id ?? null

const processingFailed = (): AppError =>
  new AppError(
    500,
    'WEBHOOK_PROCESSING_FAILED',
    'Stripe webhook processing failed.'
  )

export const createStripeWebhookService = (
  dependencies: CreateStripeWebhookDependencies
): StripeWebhookHandler => async (event, payload) => {
  let shouldProcess

  try {
    shouldProcess = await dependencies.repository.recordOrResumeEvent({
      stripeEventId: event.id,
      eventType: event.type,
      payload
    })
  } catch {
    throw processingFailed()
  }

  if (!shouldProcess) {
    return
  }

  const input: ProcessStripeEventInput = {
    stripeEventId: event.id,
    eventType: event.type,
    transition: null,
    sessionId: null,
    paymentIntentId: null,
    processedAt: dependencies.now()
  }

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.expired'
  ) {
    const session = event.data.object
    input.transition =
      event.type === 'checkout.session.completed' ? 'completed' : 'expired'
    input.sessionId = session.id
    input.paymentIntentId = paymentIntentId(session.payment_intent)
  }

  try {
    await dependencies.repository.processEvent(input)
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'Unknown processing error.'

    await dependencies.repository.recordProcessingError(event.id, reason)

    throw processingFailed()
  }
}
