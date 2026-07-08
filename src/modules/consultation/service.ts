import { AppError } from '../../middleware/errorHandler.js'
import type {
  BookingRecord,
  CheckoutCommand,
  CheckoutDependencies,
  CheckoutRequest,
  CheckoutResult,
  ConsultationAvailabilityRequest,
  ConsultationAvailabilityResult,
  ConsultationDetailsRequest,
  ConsultationDetailsResult,
  ConsultationRepository
} from './types.js'

const normalizeIntent = (booking: BookingRecord) => ({
  profileId: booking.profileId,
  method: booking.method,
  consultationDate: booking.consultationDate,
  timeSlot: booking.timeSlot,
  designField: booking.designField,
  designFocus: booking.designFocus,
  sourceImageId: booking.sourceImageId,
  notes: booking.notes
})

const normalizeCommand = (command: CheckoutCommand) => ({
  profileId: command.auth.userId,
  method: command.input.method,
  consultationDate: command.input.consultationDate,
  timeSlot: command.input.timeSlot,
  designField: command.input.designField,
  designFocus: command.input.designFocus,
  sourceImageId: command.input.sourceImageId ?? null,
  notes: command.input.notes ?? null
})

const assertSameIntent = (
  booking: BookingRecord,
  command: CheckoutCommand
): void => {
  if (
    JSON.stringify(normalizeIntent(booking)) !==
    JSON.stringify(normalizeCommand(command))
  ) {
    throw new AppError(
      409,
      'IDEMPOTENCY_KEY_REUSED',
      'The idempotency key was already used for another checkout.'
    )
  }

  if (booking.status !== 'pending_payment') {
    throw new AppError(
      409,
      'CHECKOUT_ALREADY_COMPLETED',
      'This checkout can no longer be resumed.'
    )
  }
}

const slotUnavailable = () =>
  new AppError(
    409,
    'SLOT_UNAVAILABLE',
    'The consultation slot is unavailable.'
  )

export const createConsultationCheckoutService = (
  dependencies: CheckoutDependencies
) => {
  return async (request: CheckoutRequest): Promise<CheckoutResult> => {
    if (!request.auth.email) {
      throw new AppError(
        409,
        'PROFILE_EMAIL_REQUIRED',
        'An account email is required for checkout.'
      )
    }

    const command: CheckoutCommand = {
      ...request,
      auth: {
        userId: request.auth.userId,
        email: request.auth.email
      }
    }
    const now = dependencies.now()
    const existing = await dependencies.consultations.findCheckout(
      command.auth.userId,
      command.idempotencyKey
    )

    if (existing) {
      assertSameIntent(existing.booking, command)

      if (existing.payment?.providerCheckoutSessionId) {
        return dependencies.payments.createOrResume({
          booking: existing.booking,
          payment: existing.payment
        })
      }

      const price = await dependencies.payments.prepareCheckout()
      const draft = await dependencies.consultations.createCheckoutDraft({
        command,
        contactName: existing.booking.contactName, // 已有預約紀錄時，重新建立 checkout 草稿要保留原本的聯絡人名字
        acceptedAt: now,
        price
      })

      if (!draft) {
        throw slotUnavailable()
      }

      return dependencies.payments.createOrResume({
        ...draft,
        price
      })
    }

    const profile = await dependencies.consultations.findProfile(
      command.auth.userId
    )

    if (!profile) {
      throw new AppError(
        404,
        'PROFILE_NOT_FOUND',
        'The authenticated profile was not found.'
      )
    }

    if (
      command.input.sourceImageId &&
      !(await dependencies.consultations.sourceImageExists(
        command.input.sourceImageId
      ))
    ) {
      throw new AppError(
        404,
        'SOURCE_IMAGE_NOT_FOUND',
        'The source image was not found.'
      )
    }

    const price = await dependencies.payments.prepareCheckout()
    const draft = await dependencies.consultations.createCheckoutDraft({
      command,
      contactName: profile.displayName,
      acceptedAt: now,
      price
    })

    if (!draft) {
      throw slotUnavailable()
    }

    assertSameIntent(draft.booking, command)

    return dependencies.payments.createOrResume({
      ...draft,
      price
    })
  }
}

export const createConsultationQueryService = (
  consultations: Pick<ConsultationRepository, 'findDetails'>
) => {
  return async (
    request: ConsultationDetailsRequest
  ): Promise<ConsultationDetailsResult> => {
    const details = await consultations.findDetails(request.bookingId)

    if (!details?.payment) {
      throw new AppError(
        404,
        'BOOKING_NOT_FOUND',
        'The consultation booking was not found.'
      )
    }

    if (details.profileId !== request.auth.userId) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'This consultation booking belongs to another user.'
      )
    }

    return {
      booking: {
        id: details.booking.id,
        status: details.booking.status,
        method: details.booking.method,
        consultationDate: details.booking.consultationDate,
        timeSlot: details.booking.timeSlot,
        designField: details.booking.designField ?? undefined,
        designFocus: details.booking.designFocus ?? undefined,
        notes: details.booking.notes ?? undefined,
        contactName: details.booking.contactName ?? undefined,
        contactEmail: details.booking.contactEmail,
        createdAt: details.booking.createdAt.toISOString(),
        updatedAt: details.booking.updatedAt.toISOString()
      },
      payment: {
        status: details.payment.status,
        amount: details.payment.amount,
        currency: details.payment.currency as 'TWD',
        paidAt: details.payment.paidAt?.toISOString()
      },
      consultant: details.consultant
        ? {
            id: details.consultant.id,
            displayName: details.consultant.displayName,
            title: details.consultant.title,
            avatarUrl: details.consultant.avatarUrl ?? undefined
          }
        : undefined
    }
  }
}

export const createConsultationAvailabilityService = (dependencies: {
  consultations: Pick<ConsultationRepository, 'findOccupiedSlots'>
  now(): Date
}) => {
  return async (
    request: ConsultationAvailabilityRequest
  ): Promise<ConsultationAvailabilityResult> => {
    // Availability is authenticated at route level. Auth stays on the request for user-specific rules.
    const occupied = new Set(
      await dependencies.consultations.findOccupiedSlots(
        request.date,
        dependencies.now()
      )
    )

    return {
      date: request.date,
      slots: (['am', 'pm'] as const).map((timeSlot) => ({
        timeSlot,
        available: !occupied.has(timeSlot)
      }))
    }
  }
}
