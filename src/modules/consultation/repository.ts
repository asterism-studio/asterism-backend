import type {
  Prisma,
  PrismaClient
} from '../../generated/prisma/client.js'
import type {
  BookingRecord,
  ConsultationListCursor,
  ConsultationRepository,
  FindMyBookingsInput,
  MyConsultationListRecord,
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
  contactName: booking.contactName,
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

const buildConsultationListCursorWhere = (
  cursor: ConsultationListCursor
): Prisma.ConsultationBookingWhereInput => {
  const consultationDate = toDatabaseDate(cursor.consultationDate)

  if (cursor.timeSlot === 'am') {
    return {
      OR: [
        { consultationDate: { gt: consultationDate } },
        { consultationDate, timeSlot: 'pm' },
        { consultationDate, timeSlot: 'am', id: { gt: cursor.id } }
      ]
    }
  }

  return {
    OR: [
      { consultationDate: { gt: consultationDate } },
      { consultationDate, timeSlot: 'pm', id: { gt: cursor.id } }
    ]
  }
}

const buildConsultationListWhere = (
  input: FindMyBookingsInput
): Prisma.ConsultationBookingWhereInput => {
  if (input.scope === 'upcoming') {
    const today = toDatabaseDate(input.today)

    return {
      status: 'confirmed',
      OR: [
        { consultationDate: { gt: today } },
        {
          consultationDate: today,
          timeSlot: { in: input.todayTimeSlots }
        }
      ]
    }
  }

  return input.status ? { status: input.status } : {}
}

const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'P2002'

export const occupiedSlotWhere = (
  now: Date
): Prisma.ConsultationBookingWhereInput => ({
  OR: [
    { status: { in: ['confirmed', 'completed'] } },
    {
      status: 'pending_payment',
      payment: {
        is: { checkoutExpiresAt: { gt: now } }
      }
    }
  ]
})

export const createConsultationRepository = (
  database: PrismaClient
): ConsultationRepository => ({
  findOccupiedSlots: async (date, now) => {
    const bookings = await database.consultationBooking.findMany({
      where: {
        consultationDate: toDatabaseDate(date),
        ...occupiedSlotWhere(now)
      },
      select: { timeSlot: true },
      distinct: ['timeSlot']
    })

    return bookings.map((booking) => booking.timeSlot)
  },

  findOccupiedSlotsInRange: async (startDate, endDate, now) => {
    const bookings = await database.consultationBooking.findMany({
      where: {
        consultationDate: {
          gte: toDatabaseDate(startDate),
          lte: toDatabaseDate(endDate)
        },
        ...occupiedSlotWhere(now)
      },
      select: { consultationDate: true, timeSlot: true },
      distinct: ['consultationDate', 'timeSlot']
    })

    return bookings.map((booking) => ({
      date: toDateOnly(booking.consultationDate),
      timeSlot: booking.timeSlot
    }))
  },

  findDetails: async (bookingId) => {
    const booking = await database.consultationBooking.findUnique({
      where: { id: bookingId },
      select: {
        profileId: true,
        id: true,
        status: true,
        method: true,
        consultationDate: true,
        timeSlot: true,
        designField: true,
        designFocus: true,
        notes: true,
        contactName: true,
        contactEmail: true,
        createdAt: true,
        updatedAt: true,
        payment: {
          select: {
            status: true,
            amount: true,
            currency: true,
            paidAt: true
          }
        },
        consultant: {
          select: {
            id: true,
            displayName: true,
            title: true,
            avatarUrl: true
          }
        }
      }
    })

    if (!booking) {
      return null
    }

    return {
      profileId: booking.profileId,
      booking: {
        id: booking.id,
        status: booking.status,
        method: booking.method,
        consultationDate: toDateOnly(booking.consultationDate),
        timeSlot: booking.timeSlot,
        designField: booking.designField,
        designFocus: booking.designFocus,
        notes: booking.notes,
        contactName: booking.contactName,
        contactEmail: booking.contactEmail,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt
      },
      payment: booking.payment,
      consultant: booking.consultant
    }
  },

  findMyBookings: async (input) => {
    const bookings = await database.consultationBooking.findMany({
      where: {
        profileId: input.profileId,
        ...buildConsultationListWhere(input),
        ...(input.cursor
          ? { AND: buildConsultationListCursorWhere(input.cursor) }
          : {})
      },
      orderBy: [
        { consultationDate: 'asc' },
        { timeSlot: 'asc' },
        { id: 'asc' }
      ],
      take: input.limit + 1,
      select: {
        id: true,
        status: true,
        method: true,
        consultationDate: true,
        timeSlot: true,
        designField: true,
        designFocus: true,
        notes: true,
        createdAt: true,
        consultant: {
          select: {
            displayName: true,
            title: true,
            avatarUrl: true
          }
        }
      }
    })

    return bookings.map((booking): MyConsultationListRecord => ({
      id: booking.id,
      status: booking.status,
      method: booking.method,
      consultationDate: toDateOnly(booking.consultationDate),
      timeSlot: booking.timeSlot,
      designField: booking.designField,
      designFocus: booking.designFocus,
      notes: booking.notes,
      createdAt: booking.createdAt,
      consultant: booking.consultant
    }))
  },

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

  createCheckoutDraft: async ({
    command,
    contactName,
    acceptedAt,
    price
  }) => {
    try {
      const result = await database.$transaction(async (transaction) => {
        const consultationDate = toDatabaseDate(
          command.input.consultationDate
        )
        const slot = {
          consultationDate,
          timeSlot: command.input.timeSlot
        }
        const existing = await transaction.consultationBooking.findUnique({
          where: {
            profileId_idempotencyKey: {
              profileId: command.auth.userId,
              idempotencyKey: command.idempotencyKey
            }
          },
          select: { id: true }
        })
        const excludeExisting = existing
          ? { id: { not: existing.id } }
          : {}
        const expiredPayment = {
          OR: [
            { checkoutExpiresAt: { lte: acceptedAt } },
            { checkoutExpiresAt: null }
          ]
        }

        await transaction.consultationPayment.updateMany({
          where: {
            ...expiredPayment,
            booking: {
              is: {
                ...slot,
                status: 'pending_payment',
                ...excludeExisting
              }
            }
          },
          data: {
            status: 'canceled',
            canceledAt: acceptedAt
          }
        })
        await transaction.consultationBooking.updateMany({
          where: {
            ...slot,
            status: 'pending_payment',
            ...excludeExisting,
            OR: [
              { payment: { is: null } },
              { payment: { is: expiredPayment } }
            ]
          },
          data: { status: 'canceled' }
        })

        const occupied = await transaction.consultationBooking.findFirst({
          where: {
            ...slot,
            ...excludeExisting,
            ...occupiedSlotWhere(acceptedAt)
          },
          select: { id: true }
        })

        if (occupied) {
          return null
        }

        const draftExpiresAt = new Date(
          acceptedAt.getTime() + 30 * 60 * 1000
        )
        const booking = await transaction.consultationBooking.upsert({
          where: {
            profileId_idempotencyKey: {
              profileId: command.auth.userId,
              idempotencyKey: command.idempotencyKey
            }
          },
          update: { status: 'pending_payment' },
          create: {
            idempotencyKey: command.idempotencyKey,
            profileId: command.auth.userId,
            sourceImageId: command.input.sourceImageId,
            method: command.input.method,
            consultationDate,
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
          update: {
            stripePriceId: price.stripePriceId,
            amount: price.amount,
            currency: price.currency,
            status: 'pending',
            checkoutExpiresAt: draftExpiresAt,
            failedAt: null,
            failureReason: null
          },
          create: {
            bookingId: booking.id,
            stripePriceId: price.stripePriceId,
            amount: price.amount,
            currency: price.currency,
            status: 'pending',
            checkoutExpiresAt: draftExpiresAt
          }
        })

        return { booking, payment }
      })

      if (!result) {
        return null
      }

      return {
        booking: toBookingRecord(result.booking),
        payment: toPaymentRecord(result.payment)
      }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return null
      }

      throw error
    }
  }
})
