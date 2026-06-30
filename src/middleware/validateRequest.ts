import type { RequestHandler } from 'express'
import type { ZodType } from 'zod'

import { AppError } from './errorHandler.js'

export const validateRequest = (schema: ZodType): RequestHandler => {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)

    if (!result.success) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Request validation failed.',
        result.error.issues.map(({ path, code, message }) => ({
          path: path.map(String),
          code,
          message
        }))
      )
    }

    res.locals.input = result.data
    next()
  }
}
