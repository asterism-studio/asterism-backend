import type { RequestHandler } from 'express'

import { AppError } from './errorHandler.js'

interface VerifiedUser {
  id: string
  email: string | null
}

export interface AuthVerifier {
  getUser(accessToken: string): Promise<VerifiedUser | null>
}

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
    const match = authorization?.match(/^Bearer\s+(.+)$/i)

    if (!match) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.')
    }

    let user: VerifiedUser | null

    try {
      user = await authVerifier.getUser(match[1])
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is invalid.')
    }

    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is invalid.')
    }

    if (!user.email) {
      throw new AppError(
        409,
        'PROFILE_EMAIL_REQUIRED',
        'An account email is required for checkout.'
      )
    }

    res.locals.auth = {
      userId: user.id,
      email: user.email
    }

    next()
  }
}
