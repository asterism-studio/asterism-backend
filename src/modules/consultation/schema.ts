import { z } from 'zod'

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

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
    consultationDate: z
      .string()
      .refine(isValidDateOnly, 'consultationDate must be a valid YYYY-MM-DD.')
      .refine(
        (value) => value >= getTaipeiDate(),
        'consultationDate cannot be in the past.'
      ),
    timeSlot: z.enum(['am', 'pm']),
    designField: z.string().trim().min(1).max(80),
    designFocus: z.string().trim().min(1).max(200),
    sourceImageId: optionalTrimmedString,
    notes: optionalNotes,
    paymentConsentAccepted: z.literal(true)
  })
  .strict()

export const idempotencyKeySchema = z.uuid()

