import { Router, type RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'

import { AppError } from '../../middleware/errorHandler.js'
import {
  createRequireAuth,
  type AuthVerifier
} from '../../middleware/requireAuth.js'
import { validateRequest } from '../../middleware/validateRequest.js'
import {
  availabilityQuerySchema,
  bookingIdSchema,
  consultationListQuerySchema,
  createCheckoutSchema,
  idempotencyKeySchema
} from './schema.js'
import type { AvailabilityQuery } from './schema.js'
import type {
  CheckoutRequest,
  CheckoutResult,
  ConsultationAvailabilityRequest,
  ConsultationAvailabilityResult,
  ConsultationListRequest,
  MyConsultationListResult,
  ConsultationDetailsRequest,
  ConsultationDetailsResult,
  CreateCheckoutInput
} from './types.js'

interface ConsultationRouterDependencies {
  authVerifier: AuthVerifier
  checkout(request: CheckoutRequest): Promise<CheckoutResult>
  getAvailability(
    request: ConsultationAvailabilityRequest
  ): Promise<ConsultationAvailabilityResult>
  getMyConsultations(
    request: ConsultationListRequest
  ): Promise<MyConsultationListResult>
  getBooking(
    request: ConsultationDetailsRequest
  ): Promise<ConsultationDetailsResult>
  rateLimit: {
    windowMs: number
    limit: number
  }
}

const validateIdempotencyKey: RequestHandler = (req, res, next) => {
  const result = idempotencyKeySchema.safeParse(req.header('idempotency-key'))

  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed.',
      [
        {
          path: ['headers', 'idempotency-key'],
          code: 'invalid_format',
          message: 'Idempotency-Key must be a UUID.'
        }
      ]
    )
  }

  res.locals.idempotencyKey = result.data
  next()
}

const validateBookingId: RequestHandler = (req, res, next) => {
  const result = bookingIdSchema.safeParse(req.params.bookingId)

  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed.',
      [
        {
          path: ['params', 'bookingId'],
          code: 'invalid_format',
          message: 'bookingId must be a UUID.'
        }
      ]
    )
  }

  res.locals.bookingId = result.data
  next()
}

const validateAvailabilityQuery: RequestHandler = (req, res, next) => {
  const result = availabilityQuerySchema.safeParse(req.query)

  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed.',
      result.error.issues.map(({ code, message, path }) => ({
        path: ['query', ...path],
        code,
        message
      }))
    )
  }

  res.locals.availabilityQuery = result.data
  next()
}

const validateConsultationListQuery: RequestHandler = (req, res, next) => {
  const result = consultationListQuerySchema.safeParse(req.query)

  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed.',
      result.error.issues.map(({ code, message, path }) => ({
        path: ['query', ...path],
        code,
        message
      }))
    )
  }

  res.locals.consultationListQuery = result.data
  next()
}

export const createConsultationRouter = (
  dependencies: ConsultationRouterDependencies
): Router => {
  const router = Router()

  const checkoutRateLimit = rateLimit({
    windowMs: dependencies.rateLimit.windowMs,
    limit: dependencies.rateLimit.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (_req, res) => res.locals.auth.userId,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        data: null,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many checkout requests.'
        }
      })
    }
  })

  router.post(
    '/checkout',
    createRequireAuth(dependencies.authVerifier),
    validateIdempotencyKey,
    checkoutRateLimit,
    validateRequest(createCheckoutSchema),
    async (_req, res) => {
      const idempotencyKey = res.locals.idempotencyKey as string
      const input = res.locals.input as CreateCheckoutInput

      const request: CheckoutRequest = {
        idempotencyKey,
        auth: res.locals.auth,
        input
      }

      const result = await dependencies.checkout(request)

      res.status(201).json({
        success: true,
        data: result,
        error: null
      })
    }
  )

  router.get(
    '/availability',
    createRequireAuth(dependencies.authVerifier),
    validateAvailabilityQuery,
    async (_req, res) => {
      const query = res.locals.availabilityQuery as AvailabilityQuery
      const result = await dependencies.getAvailability({
        ...query,
        auth: res.locals.auth
      })

      res.json({
        success: true,
        data: result,
        error: null
      })
    }
  )

  router.get(
    '/me',
    createRequireAuth(dependencies.authVerifier),
    validateConsultationListQuery,
    async (_req, res) => {
      const result = await dependencies.getMyConsultations({
        auth: res.locals.auth,
        query: res.locals.consultationListQuery
      })

      res.json({
        success: true,
        data: result,
        error: null
      })
    }
  )

  router.get(
    '/:bookingId',
    createRequireAuth(dependencies.authVerifier),
    validateBookingId,
    async (_req, res) => {
      const result = await dependencies.getBooking({
        bookingId: res.locals.bookingId as string,
        auth: res.locals.auth
      })

      res.json({
        success: true,
        data: result,
        error: null
      })
    }
  )

  return router
}
