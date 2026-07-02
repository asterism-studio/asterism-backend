import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import test from 'node:test'

import {
  AuthApiError,
  AuthRetryableFetchError
} from '@supabase/supabase-js'
import express, { type Express } from 'express'

import { errorHandler } from '../src/middleware/errorHandler.js'
import {
  createRequireAuth,
  createSupabaseAuthVerifier,
  type AuthVerifier
} from '../src/middleware/requireAuth.js'

const userId = '650e8400-e29b-41d4-a716-446655440000'

const withServer = async (
  app: Express,
  run: (baseUrl: string) => Promise<void>
): Promise<void> => {
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))

  try {
    const { port } = server.address() as AddressInfo
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
}

const requestProtected = async (
  authVerifier: AuthVerifier,
  authorization?: string
): Promise<{ status: number; body: unknown }> => {
  const app = express()

  app.get('/protected', createRequireAuth(authVerifier), (_req, res) => {
    res.json(res.locals.auth)
  })
  app.use(errorHandler)

  let result: { status: number; body: unknown } | undefined

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/protected`, {
      headers: authorization ? { authorization } : {}
    })

    result = {
      status: response.status,
      body: await response.json()
    }
  })

  if (!result) {
    throw new Error('Protected route did not return a response.')
  }

  return result
}

test('requireAuth stores the verified user context', async () => {
  const response = await requestProtected(
    {
      getUser: async () => ({ id: userId, email: 'user@example.com' })
    },
    'Bearer valid-token'
  )

  assert.equal(response.status, 200)
  assert.deepEqual(response.body, {
    userId,
    email: 'user@example.com'
  })
})

test('requireAuth accepts a verified user without an email', async () => {
  const response = await requestProtected(
    {
      getUser: async () => ({ id: userId, email: null })
    },
    'Bearer valid-token'
  )

  assert.equal(response.status, 200)
  assert.deepEqual(response.body, {
    userId,
    email: null
  })
})

test('requireAuth rejects missing and malformed authorization headers', async () => {
  const authVerifier: AuthVerifier = {
    getUser: async () => ({ id: userId, email: 'user@example.com' })
  }

  for (const authorization of [
    undefined,
    'Basic token',
    'Bearer',
    'Bearer token extra'
  ]) {
    const response = await requestProtected(authVerifier, authorization)
    assert.equal(response.status, 401)
  }
})

test('requireAuth rejects an invalid or expired token', async () => {
  const response = await requestProtected(
    { getUser: async () => null },
    'Bearer invalid-token'
  )

  assert.equal(response.status, 401)
})

test('requireAuth delegates unexpected verifier errors to errorHandler', async () => {
  const originalConsoleError = console.error
  console.error = () => undefined

  try {
    const response = await requestProtected(
      {
        getUser: async () => {
          throw new Error('Supabase unavailable')
        }
      },
      'Bearer valid-token'
    )

    assert.equal(response.status, 500)
    assert.deepEqual(response.body, {
      success: false,
      data: null,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected server error.'
      }
    })
  } finally {
    console.error = originalConsoleError
  }
})

test('Supabase auth verifier maps valid and invalid token results', async () => {
  const validVerifier = createSupabaseAuthVerifier({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: userId,
            email: 'user@example.com'
          }
        },
        error: null
      })
    }
  })
  const invalidVerifier = createSupabaseAuthVerifier({
    auth: {
      getUser: async () => ({
        data: { user: null },
        error: new AuthApiError('Token expired', 401, 'bad_jwt')
      })
    }
  })
  const unavailableError = new AuthRetryableFetchError(
    'Service unavailable',
    503
  )
  const unavailableVerifier = createSupabaseAuthVerifier({
    auth: {
      getUser: async () => ({
        data: { user: null },
        error: unavailableError
      })
    }
  })

  assert.deepEqual(await validVerifier.getUser('valid-token'), {
    id: userId,
    email: 'user@example.com'
  })
  assert.equal(await invalidVerifier.getUser('expired-token'), null)
  await assert.rejects(
    unavailableVerifier.getUser('valid-token'),
    (error: unknown) => error === unavailableError
  )
})
