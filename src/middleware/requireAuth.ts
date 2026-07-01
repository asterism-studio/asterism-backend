import type { RequestHandler } from 'express'
import { isAuthApiError } from '@supabase/supabase-js'

import type {
  AuthVerifier,
  VerifiedUser
} from '../modules/auth/auth.types.js'
import { AppError } from './errorHandler.js'

export type { AuthVerifier } from '../modules/auth/auth.types.js'

interface SupabaseAuthClient {
  auth: {
    getUser(accessToken: string): Promise<{
      data: {
        user: {
          id: string
          email?: string
        } | null
      }
      error: unknown
    }>
  }
}

export const createSupabaseAuthVerifier = (
  client: SupabaseAuthClient
): AuthVerifier => ({
  getUser: async (accessToken) => {
    const { data, error } = await client.auth.getUser(accessToken)

    if (
      error &&
      (!isAuthApiError(error) || ![400, 401, 403].includes(error.status))
    ) {
      throw error
    }

    if (error || !data.user) {
      return null
    }

    return {
      id: data.user.id,
      email: data.user.email ?? null
    }
  }
})

export const createRequireAuth = (
  authVerifier: AuthVerifier
): RequestHandler => {
  return async (req, res, next) => {
    const authorization = req.header('authorization')
    const match = authorization?.match(/^Bearer ([^\s]+)$/i)

    if (!match) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.')
    }

    const user = await authVerifier.getUser(match[1])

    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is invalid.')
    }

    res.locals.auth = {
      userId: user.id,
      email: user.email
    }

    next()
  }
}
