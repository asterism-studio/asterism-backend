import { AppError } from '../../middleware/errorHandler.js'
import type {
  BookingRecord,
  CheckoutCommand,
  CheckoutDependencies,
  CheckoutResult
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

export const createConsultationCheckoutService = (
  dependencies: CheckoutDependencies
) => {
  return async (command: CheckoutCommand): Promise<CheckoutResult> => {
    const now = dependencies.now()
    const existing = await dependencies.consultations.findCheckout(
      command.auth.userId,
      command.idempotencyKey
    )

    if (existing) {
      assertSameIntent(existing.booking, command)

      if (
        await dependencies.consultations.isSlotUnavailable({
          consultationDate: command.input.consultationDate,
          timeSlot: command.input.timeSlot,
          now,
          excludeBookingId: existing.booking.id
        })
      ) {
        throw new AppError(
          409,
          'SLOT_UNAVAILABLE',
          'The consultation slot is unavailable.'
        )
      }

      if (!existing.payment) {
        const price = await dependencies.payments.prepareCheckout()
        const draft = await dependencies.consultations.createCheckoutDraft({
          command,
          contactName: null,
          acceptedAt: now,
          price
        })

        return dependencies.payments.createOrResume({
          ...draft,
          price
        })
      }

      return dependencies.payments.createOrResume({
        booking: existing.booking,
        payment: existing.payment,
        price: existing.payment.providerCheckoutSessionId
          ? undefined
          : await dependencies.payments.prepareCheckout()
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

    if (
      await dependencies.consultations.isSlotUnavailable({
        consultationDate: command.input.consultationDate,
        timeSlot: command.input.timeSlot,
        now
      })
    ) {
      throw new AppError(
        409,
        'SLOT_UNAVAILABLE',
        'The consultation slot is unavailable.'
      )
    }

    const price = await dependencies.payments.prepareCheckout()
    const draft = await dependencies.consultations.createCheckoutDraft({
      command,
      contactName: profile.displayName,
      acceptedAt: now,
      price
    })

    assertSameIntent(draft.booking, command)

    return dependencies.payments.createOrResume({
      ...draft,
      price
    })
  }
}
