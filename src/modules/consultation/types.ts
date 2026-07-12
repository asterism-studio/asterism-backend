import type { z } from 'zod'

import type { AuthContext } from '../auth/auth.types.js'
import type {
  consultationListQuerySchema,
  createCheckoutSchema,
  bookingStatusSchema
} from './schema.js'

export type CreateCheckoutInput = z.output<typeof createCheckoutSchema>

export interface CheckoutResult {
  bookingId: string
  paymentId: string
  checkoutUrl: string
}

export type BookingStatus = z.infer<typeof bookingStatusSchema>

export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'refunded'

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
  contactName: string | null
  contactEmail: string
  status: BookingStatus
}

export interface PaymentRecord {
  id: string
  bookingId: string
  providerCheckoutSessionId: string | null
}

export interface CheckoutRecord {
  booking: BookingRecord
  payment: PaymentRecord | null
}

export interface CheckoutDraftRecord {
  booking: BookingRecord
  payment: PaymentRecord
}

export interface CheckoutRequest {
  idempotencyKey: string
  auth: AuthContext
  input: CreateCheckoutInput
}

export interface ConsultationDetailsRecord {
  profileId: string
  booking: {
    id: string
    status: BookingStatus
    method: CreateCheckoutInput['method']
    consultationDate: string
    timeSlot: CreateCheckoutInput['timeSlot']
    designField: string | null
    designFocus: string | null
    notes: string | null
    contactName: string | null
    contactEmail: string
    createdAt: Date
    updatedAt: Date
  }
  payment: {
    status: PaymentStatus
    amount: number
    currency: string
    paidAt: Date | null
  } | null
  consultant: {
    id: string
    displayName: string
    title: string
    avatarUrl: string | null
  } | null
}

export interface ConsultationDetailsRequest {
  bookingId: string
  auth: AuthContext
}

export type ConsultationAvailabilityRequest = {
  date: string
  auth: AuthContext
} | {
  month: string
  auth: AuthContext
}

export type ConsultationTimeSlot = CreateCheckoutInput['timeSlot']

export interface ConsultationDayAvailability {
  date: string
  slots: Array<{
    timeSlot: ConsultationTimeSlot
    available: boolean
  }>
}

export type ConsultationAvailabilityResult =
  | ConsultationDayAvailability
  | {
      month: string
      startDate: string
      endDate: string
      days: ConsultationDayAvailability[]
    }

export interface ConsultationDetailsResult {
  booking: {
    id: string
    status: BookingStatus
    method: CreateCheckoutInput['method']
    consultationDate: string
    timeSlot: CreateCheckoutInput['timeSlot']
    designField?: string
    designFocus?: string
    notes?: string
    contactName?: string
    contactEmail: string
    createdAt: string
    updatedAt: string
  }
  payment: {
    status: PaymentStatus
    amount: number
    currency: 'TWD'
    paidAt?: string
  }
  consultant?: {
    id: string
    displayName: string
    title: string
    avatarUrl?: string
  }
}

export type ConsultationListQuery = z.output<typeof consultationListQuerySchema>

export interface ConsultationListCursor {
  version: 1
  status?: BookingStatus
  consultationDate: string
  timeSlot: ConsultationTimeSlot
  id: string
}

export interface MyConsultationListRecord {
  id: string
  status: BookingStatus
  method: CreateCheckoutInput['method']
  consultationDate: string
  timeSlot: ConsultationTimeSlot
  designField: string | null
  designFocus: string | null
  notes: string | null
  createdAt: Date
  consultant: {
    displayName: string
    title: string
    avatarUrl: string | null
  } | null
}

export interface MyConsultationListItem {
  id: string
  status: BookingStatus
  method: CreateCheckoutInput['method']
  consultationDate: string
  timeSlot: ConsultationTimeSlot
  designField?: string
  designFocus?: string
  notes?: string
  consultant?: {
    displayName: string
    title: string
    avatarUrl?: string
  }
  createdAt: string
}

export interface MyConsultationListResult {
  items: MyConsultationListItem[]
  nextCursor?: string
}

export interface ConsultationListRequest {
  auth: AuthContext
  query: ConsultationListQuery
}

export interface CheckoutCommand {
  idempotencyKey: string
  auth: {
    userId: string
    email: string
  }
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
  findDetails(bookingId: string): Promise<ConsultationDetailsRecord | null>
  findMyBookings(input: {
    profileId: string
    status?: BookingStatus
    limit: number
    cursor?: ConsultationListCursor
  }): Promise<MyConsultationListRecord[]>
  findOccupiedSlots(
    date: string,
    now: Date
  ): Promise<ConsultationTimeSlot[]>
  findOccupiedSlotsInRange(
    startDate: string,
    endDate: string,
    now: Date
  ): Promise<Array<{ date: string; timeSlot: ConsultationTimeSlot }>>
  findCheckout(
    profileId: string,
    idempotencyKey: string
  ): Promise<CheckoutRecord | null>
  findProfile(profileId: string): Promise<ProfileSnapshot | null>
  sourceImageExists(sourceImageId: string): Promise<boolean>
  createCheckoutDraft(input: {
    command: CheckoutCommand
    contactName: string | null
    acceptedAt: Date
    price: CheckoutPrice
  }): Promise<CheckoutDraftRecord | null>
}

export interface PaymentCheckoutService {
  prepareCheckout(): Promise<CheckoutPrice>
  createOrResume(input: {
    booking: BookingRecord
    payment: PaymentRecord
    price?: CheckoutPrice
  }): Promise<CheckoutResult>
}

export interface CheckoutDependencies {
  consultations: ConsultationRepository
  payments: PaymentCheckoutService
  now(): Date
}
