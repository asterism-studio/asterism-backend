import { AppError } from '../../middleware/errorHandler.js'
import type Stripe from 'stripe'
import type {
  CheckoutPrice,
  CheckoutResult,
  PaymentCheckoutService
} from '../consultation/types.js'
import type {
  CreatePaymentCheckoutDependencies,
  StripeCheckoutGateway,
  StripeCheckoutSession
} from './types.js'

const CONSULTATION_DEPOSIT_AMOUNT = 50_000

export const createStripeCheckoutGateway = (
  stripe: Stripe
): StripeCheckoutGateway => ({
  retrievePrice: async (priceId) => {
    const price = await stripe.prices.retrieve(priceId)

    return {
      id: price.id,
      active: price.active,
      currency: price.currency,
      unitAmount: price.unit_amount
    }
  },

  createSession: async (input, idempotencyKey) => {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [{ price: input.priceId, quantity: 1 }],
        customer_email: input.customerEmail,
        client_reference_id: input.bookingId,
        metadata: {
          bookingId: input.bookingId,
          profileId: input.profileId
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl
      },
      { idempotencyKey }
    )

    if (!session.status) {
      throw new Error('Stripe Checkout Session status is missing.')
    }

    return {
      id: session.id,
      status: session.status,
      url: session.url,
      expiresAt: new Date(session.expires_at * 1000)
    }
  },

  retrieveSession: async (sessionId) => {
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    if (!session.status) {
      throw new Error('Stripe Checkout Session status is missing.')
    }

    return {
      id: session.id,
      status: session.status,
      url: session.url,
      expiresAt: new Date(session.expires_at * 1000)
    }
  }
})

const providerError = (): AppError =>
  new AppError(
    502,
    'CHECKOUT_PROVIDER_ERROR',
    'The checkout provider is temporarily unavailable.'
  )

const toCheckoutResult = (
  bookingId: string,
  paymentId: string,
  session: StripeCheckoutSession
): CheckoutResult => {
  if (session.status === 'complete') {
    throw new AppError(
      409,
      'CHECKOUT_ALREADY_COMPLETED',
      'This checkout can no longer be resumed.'
    )
  }

  if (session.status === 'expired') {
    throw new AppError(
      409,
      'CHECKOUT_EXPIRED',
      'This checkout session has expired.'
    )
  }

  if (!session.url) {
    throw providerError()
  }

  return {
    bookingId,
    paymentId,
    checkoutUrl: session.url
  }
}

export const createPaymentCheckoutService = (
  dependencies: CreatePaymentCheckoutDependencies
): PaymentCheckoutService => {
  const prepareCheckout = async (): Promise<CheckoutPrice> => {
    let price

    try {
      price = await dependencies.stripe.retrievePrice(
        dependencies.stripePriceId
      )
    } catch {
      throw providerError()
    }

    const unitAmount = price.unitAmount

    if (
      price.id !== dependencies.stripePriceId ||
      !price.active ||
      price.currency.toUpperCase() !== 'TWD' ||
      unitAmount !== CONSULTATION_DEPOSIT_AMOUNT
    ) {
      throw new AppError(
        503,
        'CHECKOUT_CONFIGURATION_ERROR',
        'Checkout is not configured correctly.'
      )
    }

    return {
      stripePriceId: price.id,
      amount: unitAmount,
      currency: 'TWD'
    }
  }

  const createOrResume: PaymentCheckoutService['createOrResume'] = async ({
    booking,
    payment,
    price
  }) => {
    if (payment.providerCheckoutSessionId) {
      let session

      try {
        session = await dependencies.stripe.retrieveSession(
          payment.providerCheckoutSessionId
        )
      } catch {
        throw providerError()
      }

      return toCheckoutResult(booking.id, payment.id, session)
    }

    const resolvedPrice = price ?? (await prepareCheckout())
    let session: StripeCheckoutSession

    try {
      session = await dependencies.stripe.createSession(
        {
          priceId: resolvedPrice.stripePriceId,
          customerEmail: booking.contactEmail,
          bookingId: booking.id,
          profileId: booking.profileId,
          successUrl: dependencies.successUrl,
          cancelUrl: dependencies.cancelUrl
        },
        `consultation-checkout:${booking.id}`
      )
    } catch {
      await dependencies.payments.markFailed(
        payment.id,
        'Stripe Checkout Session creation failed.',
        dependencies.now()
      )
      throw providerError()
    }

    const storedPayment = await dependencies.payments.attachSession({
      paymentId: payment.id,
      providerCheckoutSessionId: session.id,
      checkoutExpiresAt: session.expiresAt
    })

    return toCheckoutResult(booking.id, storedPayment.id, session)
  }

  return { prepareCheckout, createOrResume }
}
