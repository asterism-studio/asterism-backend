import type {
  Prisma,
  PrismaClient
} from '../../generated/prisma/client.js'
import type {
  BookingRecord,
  ConsultationRepository,
  PaymentRecord
} from './types.js'

type BookingWithPayment = Prisma.ConsultationBookingGetPayload<{
  include: { payment: true }
}>
type Booking = Prisma.ConsultationBookingGetPayload<object>

const toDateOnly = (date: Date): string => date.toISOString().slice(0, 10)

const toBookingRecord = (
  booking: Booking
): BookingRecord => ({
  id: booking.id,
  profileId: booking.profileId,
  method: booking.method,
  consultationDate: toDateOnly(booking.consultationDate),
  timeSlot: booking.timeSlot,
  designField: booking.designField,
  designFocus: booking.designFocus,
  sourceImageId: booking.sourceImageId,
  notes: booking.notes,
  contactEmail: booking.contactEmail,
  status: booking.status
})

const toPaymentRecord = (
  payment: NonNullable<BookingWithPayment['payment']>
): PaymentRecord => ({
  id: payment.id,
  bookingId: payment.bookingId,
  providerCheckoutSessionId: payment.providerCheckoutSessionId
})

const toDatabaseDate = (date: string): Date =>
  new Date(`${date}T00:00:00.000Z`)

export const createConsultationRepository = (
  database: PrismaClient
): ConsultationRepository => ({
  findCheckout: async (profileId, idempotencyKey) => {
    const booking = await database.consultationBooking.findUnique({
      where: {
        profileId_idempotencyKey: { profileId, idempotencyKey }
      },
      include: { payment: true }
    })

    if (!booking) {
      return null
    }

    return {
      booking: toBookingRecord(booking),
      payment: booking.payment ? toPaymentRecord(booking.payment) : null
    }
  },

  findProfile: (profileId) =>
    database.profile.findUnique({
      where: { id: profileId },
      select: { id: true, displayName: true }
    }),

  sourceImageExists: async (sourceImageId) =>
    Boolean(
      await database.image.findUnique({
        where: { id: sourceImageId },
        select: { id: true }
      })
    ),

  isSlotUnavailable: async ({
    consultationDate,
    timeSlot,
    now,
    excludeBookingId
  }) =>
    Boolean(
      await database.consultationBooking.findFirst({
        where: {
          consultationDate: toDatabaseDate(consultationDate),
          timeSlot,
          OR: [
            { status: { in: ['confirmed', 'completed'] } },
            {
              status: 'pending_payment',
              payment: {
                is: {
                  checkoutExpiresAt: { gt: now }
                }
              }
            }
          ],
          ...(excludeBookingId ? { id: { not: excludeBookingId } } : {})
        },
        select: { id: true }
      })
    ),

  createCheckoutDraft: async ({
    command,
    contactName,
    acceptedAt,
    price
  }) => {
    const result = await database.$transaction(async (transaction) => {
      const booking = await transaction.consultationBooking.upsert({
        where: {
          profileId_idempotencyKey: {
            profileId: command.auth.userId,
            idempotencyKey: command.idempotencyKey
          }
        },
        update: {},
        create: {
          idempotencyKey: command.idempotencyKey,
          profileId: command.auth.userId,
          sourceImageId: command.input.sourceImageId,
          method: command.input.method,
          consultationDate: toDatabaseDate(command.input.consultationDate),
          timeSlot: command.input.timeSlot,
          designField: command.input.designField,
          designFocus: command.input.designFocus,
          contactName,
          contactEmail: command.auth.email,
          notes: command.input.notes,
          paymentConsentAcceptedAt: acceptedAt,
          status: 'pending_payment'
        }
      })
      const payment = await transaction.consultationPayment.upsert({
        where: { bookingId: booking.id },
        update: {},
        create: {
          bookingId: booking.id,
          stripePriceId: price.stripePriceId,
          amount: price.amount,
          currency: price.currency,
          status: 'pending'
        }
      })

      return { booking, payment }
    })

    return {
      booking: toBookingRecord(result.booking),
      payment: toPaymentRecord(result.payment)
    }
  }
})
