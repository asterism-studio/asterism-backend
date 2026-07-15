import { AppError } from '../../middleware/errorHandler.js'
import { consultationListCursorSchema } from './schema.js'
import type {
  BookingStatus,
  ConsultationListCursor,
  ConsultationListScope
} from './types.js'

const invalidCursor = (): AppError =>
  new AppError(
    400,
    'VALIDATION_ERROR',
    'Request validation failed.'
  )

export const encodeConsultationListCursor = (
  cursor: ConsultationListCursor
): string => Buffer.from(JSON.stringify(cursor)).toString('base64url')

export const decodeConsultationListCursor = (
  value: string,
  scope: ConsultationListScope,
  status?: BookingStatus
): ConsultationListCursor => {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8')
    )
    const result = consultationListCursorSchema.safeParse(decoded)

    const matchesContext =
      result.success &&
      result.data.scope === scope &&
      (scope === 'upcoming'
        ? result.data.status === undefined
        : result.data.status === status)

    if (!matchesContext) {
      throw invalidCursor()
    }

    return result.data
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }

    throw invalidCursor()
  }
}
