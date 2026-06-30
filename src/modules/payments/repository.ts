import type { PrismaClient } from '../../generated/prisma/client.js'
import type { PaymentRepository } from './types.js'

export const createPaymentRepository = (
  database: PrismaClient
): PaymentRepository => ({
  createOrGet: async (input) => {
    const payment = await database.consultationPayment.upsert({
      where: { bookingId: input.bookingId },
      update: {},
      create: {
        bookingId: input.bookingId,
        stripePriceId: input.stripePriceId,
        providerCheckoutSessionId: input.providerCheckoutSessionId,
        amount: input.amount,
        currency: input.currency,
        checkoutExpiresAt: input.checkoutExpiresAt
      }
    })

    return {
      id: payment.id,
      bookingId: payment.bookingId,
      providerCheckoutSessionId: payment.providerCheckoutSessionId
    }
  }
})
