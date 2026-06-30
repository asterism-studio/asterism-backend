import type { z } from 'zod'

import type { createCheckoutSchema } from './schema.js'

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>

export interface AuthContext {
  userId: string
  email: string
}

export interface CheckoutResult {
  bookingId: string
  paymentId: string
  checkoutUrl: string
}

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'payment_failed'
  | 'canceled'
  | 'completed'

export interface BookingRecord {
  id: string
  profileId: string
  method: CreateCheckoutInput['method']
  consultationDate: string
  timeSlot: CreateCheckoutInput['timeSlot']
  designField: string | null
  designFocus: string | null
  sourceImageId: string | null
  notes: string | null
  contactEmail: string
  status: BookingStatus
}

export interface PaymentRecord {
  id: string
  bookingId: string
  providerCheckoutSessionId: string
}

export interface CheckoutRecord {
  booking: BookingRecord
  payment: PaymentRecord | null
}

export interface CheckoutCommand {
  idempotencyKey: string
  auth: AuthContext
  input: CreateCheckoutInput
}

export interface ProfileSnapshot {
  id: string
  displayName: string | null
}

export interface CheckoutPrice {
  stripePriceId: string
  amount: number
  currency: 'TWD'
}

export interface ConsultationRepository {
  findCheckout(bookingId: string): Promise<CheckoutRecord | null>
  findProfile(profileId: string): Promise<ProfileSnapshot | null>
  sourceImageExists(sourceImageId: string): Promise<boolean>
  isSlotUnavailable(input: {
    consultationDate: string
    timeSlot: CreateCheckoutInput['timeSlot']
    excludeBookingId?: string
  }): Promise<boolean>
  createBooking(input: {
    command: CheckoutCommand
    contactName: string | null
    acceptedAt: Date
  }): Promise<BookingRecord>
}

export interface PaymentCheckoutService {
  prepareCheckout(): Promise<CheckoutPrice>
  createOrResume(input: {
    booking: BookingRecord
    payment: PaymentRecord | null
    price?: CheckoutPrice
  }): Promise<CheckoutResult>
}

export interface CheckoutDependencies {
  consultations: ConsultationRepository
  payments: PaymentCheckoutService
  now(): Date
}
