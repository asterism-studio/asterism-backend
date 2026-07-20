import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createConsultationRepository,
  DESIGN_FIELD_SPECIALTY
} from '../src/modules/consultation/repository.js'
import type { CheckoutCommand } from '../src/modules/consultation/types.js'

const consultantId = '0aae2673-e4c3-4bb0-8283-b8b75b5f03a5'
const acceptedAt = new Date('2099-07-01T00:00:00.000Z')

const buildCommand = (designField: string): CheckoutCommand => ({
  idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
  auth: { userId: '650e8400-e29b-41d4-a716-446655440000', email: 'user@example.com' },
  input: {
    method: 'online',
    consultationDate: '2099-07-10',
    timeSlot: 'am',
    designField,
    designFocus: 'color',
    sourceImageId: undefined,
    notes: undefined,
    paymentConsentAccepted: true
  }
})

const runCheckoutDraft = async (designField: string) => {
  let consultantWhere: unknown = null
  let upsertInput: { create?: { consultantId?: string } } = {}

  const bookingRow = {
    id: '850e8400-e29b-41d4-a716-446655440000',
    profileId: '650e8400-e29b-41d4-a716-446655440000',
    method: 'online',
    consultationDate: new Date('2099-07-10T00:00:00.000Z'),
    timeSlot: 'am',
    designField,
    designFocus: 'color',
    sourceImageId: null,
    notes: null,
    contactName: null,
    contactEmail: 'user@example.com',
    status: 'pending_payment'
  }

  const transaction = {
    consultationBooking: {
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
      upsert: async (input: typeof upsertInput) => {
        upsertInput = input
        return bookingRow
      }
    },
    consultationPayment: {
      updateMany: async () => ({ count: 0 }),
      upsert: async () => ({
        id: '750e8400-e29b-41d4-a716-446655440000',
        bookingId: bookingRow.id,
        providerCheckoutSessionId: null
      })
    },
    consultant: {
      findFirst: async (input: unknown) => {
        consultantWhere = input
        return { id: consultantId }
      }
    }
  }

  const repository = createConsultationRepository({
    $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction)
  } as unknown as Parameters<typeof createConsultationRepository>[0])

  const draft = await repository.createCheckoutDraft({
    command: buildCommand(designField),
    contactName: null,
    acceptedAt,
    price: { stripePriceId: 'price_1', amount: 1000, currency: 'twd' }
  })

  return { draft, consultantWhere, upsertInput }
}

test('checkout draft assigns the active consultant matching the design field', async () => {
  const { draft, consultantWhere, upsertInput } = await runCheckoutDraft('styling')

  assert.deepEqual(consultantWhere, {
    where: { specialty: 'visual_styling', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true }
  })
  assert.equal(upsertInput.create?.consultantId, consultantId)
  assert.equal(draft?.booking.designField, 'styling')
})

test('checkout draft leaves unknown design fields unassigned', async () => {
  const { consultantWhere, upsertInput } = await runCheckoutDraft('something-else')

  assert.equal(consultantWhere, null)
  assert.equal(upsertInput.create?.consultantId, undefined)
})

test('design field mapping covers every booking form option', () => {
  assert.deepEqual(DESIGN_FIELD_SPECIALTY, {
    styling: 'visual_styling',
    graphic: 'concept_design',
    interior: 'spatial',
    architecture: 'spatial'
  })
})
