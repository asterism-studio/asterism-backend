import { Router, type RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'

import { AppError } from '../../middleware/errorHandler.js'
import {
  createRequireAuth,
  type AuthVerifier
} from '../../middleware/requireAuth.js'
import { validateRequest } from '../../middleware/validateRequest.js'
import {
  createCheckoutSchema,
  idempotencyKeySchema
} from './schema.js'
import type {
  CheckoutCommand,
  CheckoutResult,
  CreateCheckoutInput
} from './types.js'

interface ConsultationRouterDependencies {
  authVerifier: AuthVerifier
  checkout(command: CheckoutCommand): Promise<CheckoutResult>
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

      const command: CheckoutCommand = {
        idempotencyKey,
        auth: res.locals.auth,
        input
      }

      const result = await dependencies.checkout(command)

      res.status(201).json({
        success: true,
        data: result,
        error: null
      })
    }
  )

  return router
}