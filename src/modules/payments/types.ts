import type { PaymentRecord } from '../consultation/types.js'

export interface StripePrice {
  id: string
  active: boolean
  currency: string
  unitAmount: number | null
}

export interface StripeCheckoutSession {
  id: string
  status: 'open' | 'complete' | 'expired'
  url: string | null
  expiresAt: Date | null
}

export interface CreateStripeSessionInput {
  priceId: string
  customerEmail: string
  bookingId: string
  profileId: string
  successUrl: string
  cancelUrl: string
}

export interface StripeCheckoutGateway {
  retrievePrice(priceId: string): Promise<StripePrice>
  createSession(
    input: CreateStripeSessionInput,
    idempotencyKey: string
  ): Promise<StripeCheckoutSession>
  retrieveSession(sessionId: string): Promise<StripeCheckoutSession>
}

export interface AttachSessionInput {
  paymentId: string
  providerCheckoutSessionId: string
  checkoutExpiresAt: Date | null
}

export interface PaymentRepository {
  attachSession(input: AttachSessionInput): Promise<PaymentRecord>
  markFailed(
    paymentId: string,
    failureReason: string,
    failedAt: Date
  ): Promise<void>
}

export interface CreatePaymentCheckoutDependencies {
  stripe: StripeCheckoutGateway
  payments: PaymentRepository
  stripePriceId: string
  successUrl: string
  cancelUrl: string
  now(): Date
}
