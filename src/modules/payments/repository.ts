import type { PrismaClient } from '../../generated/prisma/client.js'
import type {
  PaymentRepository,
  ProcessStripeEventInput,
  StripeWebhookRepository
} from './types.js'

export const createPaymentRepository = (
  database: PrismaClient
): PaymentRepository => ({
  attachSession: async (input) => {
    const payment = await database.consultationPayment.update({
      where: { id: input.paymentId },
      data: {
        providerCheckoutSessionId: input.providerCheckoutSessionId,
        checkoutExpiresAt: input.checkoutExpiresAt,
        status: 'pending',
        failedAt: null,
        failureReason: null
      }
    })

    return {
      id: payment.id,
      bookingId: payment.bookingId,
      providerCheckoutSessionId: payment.providerCheckoutSessionId
    }
  },
  markFailed: async (paymentId, failureReason, failedAt) => {
    await database.consultationPayment.update({
      where: { id: paymentId },
      data: {
        status: 'failed',
        failureReason,
        failedAt
      }
    })
  }
})

const ignoredReason = (
  input: ProcessStripeEventInput,
  paymentStatus: string,
  bookingStatus: string
): string => {
  if (
    input.transition === 'completed' &&
    ['canceled', 'failed', 'refunded'].includes(paymentStatus)
  ) {
    return `Status conflict: ${input.eventType} cannot transition payment from ${paymentStatus} and booking from ${bookingStatus}.`
  }

  return `Ignored ${input.eventType}: expected payment pending and booking pending_payment, received ${paymentStatus} and ${bookingStatus}.`
}

export const createStripeWebhookRepository = (
  database: PrismaClient
): StripeWebhookRepository => ({
  recordEvent: async (input) => {
    const result = await database.stripeWebhookEvent.createMany({
      data: {
        stripeEventId: input.stripeEventId,
        eventType: input.eventType,
        payload: input.payload
      },
      skipDuplicates: true
    })

    return result.count === 1
  },

  processEvent: async (input) => {
    await database.$transaction(async (transaction) => {
      const finish = (processingError: string | null) =>
        transaction.stripeWebhookEvent.update({
          where: { stripeEventId: input.stripeEventId },
          data: {
            processedAt: input.processedAt,
            processingError
          }
        })

      if (!input.transition) {
        await finish(`Ignored unsupported Stripe event: ${input.eventType}.`)
        return
      }

      if (!input.sessionId) {
        await finish(`Ignored ${input.eventType}: Checkout Session ID is missing.`)
        return
      }

      const payment = await transaction.consultationPayment.findUnique({
        where: { providerCheckoutSessionId: input.sessionId },
        include: { booking: true }
      })

      if (!payment) {
        await finish(
          `Payment not found for Checkout Session ${input.sessionId}.`
        )
        return
      }

      if (
        payment.status !== 'pending' ||
        payment.booking.status !== 'pending_payment'
      ) {
        await finish(
          ignoredReason(
            input,
            payment.status,
            payment.booking.status
          )
        )
        return
      }

      const paymentUpdate =
        input.transition === 'completed'
          ? {
              status: 'paid' as const,
              paidAt: input.processedAt,
              providerPaymentIntentId: input.paymentIntentId
            }
          : {
              status: 'canceled' as const,
              canceledAt: input.processedAt
            }
      const paymentResult =
        await transaction.consultationPayment.updateMany({
          where: { id: payment.id, status: 'pending' },
          data: paymentUpdate
        })
      const bookingResult =
        await transaction.consultationBooking.updateMany({
          where: {
            id: payment.booking.id,
            status: 'pending_payment'
          },
          data: {
            status:
              input.transition === 'completed'
                ? 'confirmed'
                : 'canceled'
          }
        })

      if (paymentResult.count !== 1 || bookingResult.count !== 1) {
        throw new Error(
          `Concurrent status change while processing ${input.eventType}.`
        )
      }

      await finish(null)
    })
  },

  recordProcessingError: async (stripeEventId, reason) => {
    await database.stripeWebhookEvent.update({
      where: { stripeEventId },
      data: { processingError: reason }
    })
  }
})
