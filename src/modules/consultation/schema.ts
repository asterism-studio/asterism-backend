import { z } from 'zod'

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MONTH_ONLY_PATTERN = /^\d{4}-\d{2}$/

export const bookingStatusSchema = z.enum([
  'pending_payment',
  'confirmed',
  'payment_failed',
  'canceled',
  'completed'
])

const isValidDateOnly = (value: string): boolean => {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return false
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

const getTaipeiDate = (): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}-${values.month}-${values.day}`
}

const getTaipeiMonth = (): string => getTaipeiDate().slice(0, 7)

const validDateOnlySchema = z
  .string()
  .refine(isValidDateOnly, 'Value must be a valid YYYY-MM-DD.')

const dateOnlySchema = (fieldName: string) => z
  .string()
  .refine(isValidDateOnly, `${fieldName} must be a valid YYYY-MM-DD.`)
  .refine(
    (value) => value >= getTaipeiDate(),
    `${fieldName} cannot be in the past.`
  )

const monthOnlySchema = z
  .string()
  .refine((value) => {
    if (!MONTH_ONLY_PATTERN.test(value)) {
      return false
    }

    const [year, month] = value.split('-').map(Number)

    return month >= 1 && month <= 12 && year >= 1
  }, 'month must be a valid YYYY-MM.')
  .refine(
    (value) => value >= getTaipeiMonth(),
    'month cannot be in the past.'
  )

const optionalTrimmedString = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional()

const optionalNotes = z
  .string()
  .trim()
  .max(1000)
  .transform((value) => value || undefined)
  .optional()

export const createCheckoutSchema = z
  .object({
    method: z
      .enum(['online', 'in-person'])
      .transform((value) => (value === 'in-person' ? 'in_person' : value)),
    consultationDate: dateOnlySchema('consultationDate'),
    timeSlot: z.enum(['am', 'pm']),
    designField: z.string().trim().min(1).max(80),
    designFocus: z.string().trim().min(1).max(200),
    sourceImageId: optionalTrimmedString,
    notes: optionalNotes,
    paymentConsentAccepted: z.literal(true)
  })
  .strict()

export const idempotencyKeySchema = z.uuid()
export const bookingIdSchema = z.uuid()
export const availabilityDateSchema = dateOnlySchema('date')
export const availabilityQuerySchema = z.union([
  z
    .object({
      date: availabilityDateSchema,
      month: z.undefined().optional()
    })
    .strict(),
  z
    .object({
      date: z.undefined().optional(),
      month: monthOnlySchema
    })
    .strict()
])

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>

export const consultationListQuerySchema = z
  .object({
    status: bookingStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).optional()
  })
  .strict()

export const consultationListCursorSchema = z
  .object({
    version: z.literal(1),
    status: bookingStatusSchema.optional(),
    consultationDate: validDateOnlySchema,
    timeSlot: z.enum(['am', 'pm']),
    id: z.uuid()
  })
  .strict()
