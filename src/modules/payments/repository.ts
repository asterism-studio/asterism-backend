import type { PrismaClient } from '../../generated/prisma/client.js'
import type { PaymentRepository } from './types.js'

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
