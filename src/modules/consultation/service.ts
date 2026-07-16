import { AppError } from '../../middleware/errorHandler.js'
import {
  decodeConsultationListCursor,
  encodeConsultationListCursor
} from './pagination.js'
import type {
  BookingRecord,
  CheckoutCommand,
  CheckoutDependencies,
  CheckoutRequest,
  CheckoutResult,
  ConsultationDayAvailability,
  ConsultationAvailabilityRequest,
  ConsultationAvailabilityResult,
  ConsultationListRequest,
  ConsultationListCursor,
  ConsultationDetailsRequest,
  ConsultationDetailsResult,
  ConsultationTimeSlot,
  MyConsultationListItem,
  MyConsultationListRecord,
  MyConsultationListResult,
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

const toDateOnly = (date: Date): string => date.toISOString().slice(0, 10)

const optionalText = (value: string | null): string | undefined => {
  if (!value || value.trim().length === 0) {
    return undefined
  }

  return value
}

const getTaipeiDateTimeParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  )

  if (!values.year || !values.month || !values.day || !values.hour) {
    throw new Error('Failed to resolve Taipei date and time.')
  }

  return values
}

const toTaipeiDateOnly = (date: Date): string => {
  const values = getTaipeiDateTimeParts(date)

  return `${values.year}-${values.month}-${values.day}`
}

const getTaipeiUpcomingWindow = (date: Date): {
  today: string
  todayTimeSlots: ConsultationTimeSlot[]
} => {
  const values = getTaipeiDateTimeParts(date)

  return {
    today: `${values.year}-${values.month}-${values.day}`,
    todayTimeSlots: Number(values.hour) < 12 ? ['am', 'pm'] : ['pm']
  }
}

const getMonthRange = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number)
  const startDate = `${month}-01`
  const endDate = toDateOnly(new Date(Date.UTC(year, monthNumber, 0)))

  return { startDate, endDate }
}

const buildDayAvailability = (
  date: string,
  occupied: Set<string>,
  today: string
): ConsultationDayAvailability => ({
  date,
  slots: (['am', 'pm'] as const).map((timeSlot) => ({
    timeSlot,
    available: date >= today && !occupied.has(`${date}:${timeSlot}`)
  }))
})

const buildMonthDates = (startDate: string, endDate: string): string[] => {
  const dates: string[] = []
  const current = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)

  while (current <= end) {
    dates.push(toDateOnly(current))
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return dates
}

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

const toConsultationListItem = (
  record: MyConsultationListRecord
): MyConsultationListItem => ({
  id: record.id,
  status: record.status,
  method: record.method,
  consultationDate: record.consultationDate,
  timeSlot: record.timeSlot,
  ...(optionalText(record.designField)
    ? { designField: optionalText(record.designField) }
    : {}),
  ...(optionalText(record.designFocus)
    ? { designFocus: optionalText(record.designFocus) }
    : {}),
  ...(optionalText(record.notes) ? { notes: optionalText(record.notes) } : {}),
  ...(record.consultant
    ? {
        consultant: {
          displayName: record.consultant.displayName,
          title: record.consultant.title,
          ...(optionalText(record.consultant.avatarUrl)
            ? { avatarUrl: optionalText(record.consultant.avatarUrl) }
            : {})
        }
      }
    : {}),
  createdAt: record.createdAt.toISOString()
})

export const createConsultationListService = (
  dependencies: {
    consultations: Pick<
      ConsultationRepository,
      'findProfile' | 'findMyBookings'
    >
    now(): Date
  }
) => {
  const { consultations } = dependencies

  return async (
    request: ConsultationListRequest
  ): Promise<MyConsultationListResult> => {
    const profile = await consultations.findProfile(request.auth.userId)

    if (!profile) {
      throw new AppError(
        404,
        'PROFILE_NOT_FOUND',
        'The authenticated profile was not found.'
      )
    }

    const cursor = request.query.cursor
      ? decodeConsultationListCursor(
          request.query.cursor,
          request.query.scope,
          request.query.scope === 'all' ? request.query.status : undefined
        )
      : undefined
    const records =
      request.query.scope === 'upcoming'
        ? await consultations.findMyBookings({
            profileId: profile.id,
            scope: 'upcoming',
            limit: request.query.limit,
            cursor,
            ...getTaipeiUpcomingWindow(dependencies.now())
          })
        : await consultations.findMyBookings({
            profileId: profile.id,
            scope: 'all',
            status: request.query.status,
            limit: request.query.limit,
            cursor
          })
    const hasNextPage = records.length > request.query.limit
    const visibleRecords = hasNextPage
      ? records.slice(0, request.query.limit)
      : records
    const items = visibleRecords.map(toConsultationListItem)
    const lastRecord = visibleRecords.at(-1)

    if (!hasNextPage || !lastRecord) {
      return { items }
    }

    const nextCursor: ConsultationListCursor = {
      version: 1,
      scope: request.query.scope,
      ...(request.query.scope === 'all' && request.query.status
        ? { status: request.query.status }
        : {}),
      consultationDate: lastRecord.consultationDate,
      timeSlot: lastRecord.timeSlot,
      id: lastRecord.id
    }

    return {
      items,
      nextCursor: encodeConsultationListCursor(nextCursor)
    }
  }
}

export const createConsultationAvailabilityService = (dependencies: {
  consultations: Pick<
    ConsultationRepository,
    'findOccupiedSlots' | 'findOccupiedSlotsInRange'
  >
  now(): Date
}) => {
  return async (
    request: ConsultationAvailabilityRequest
  ): Promise<ConsultationAvailabilityResult> => {
    // Availability is authenticated at route level. Auth stays on the request for user-specific rules.
    const now = dependencies.now()
    const today = toTaipeiDateOnly(now)

    if ('month' in request) {
      const { startDate, endDate } = getMonthRange(request.month)
      const occupied = new Set(
        (
          await dependencies.consultations.findOccupiedSlotsInRange(
            startDate,
            endDate,
            now
          )
        ).map(({ date, timeSlot }) => `${date}:${timeSlot}`)
      )

      return {
        month: request.month,
        startDate,
        endDate,
        days: buildMonthDates(startDate, endDate).map((date) =>
          buildDayAvailability(date, occupied, today)
        )
      }
    }

    const occupied = new Set(
      (await dependencies.consultations.findOccupiedSlots(
        request.date,
        now
      )).map((timeSlot) => `${request.date}:${timeSlot}`)
    )

    return buildDayAvailability(request.date, occupied, today)
  }
}
