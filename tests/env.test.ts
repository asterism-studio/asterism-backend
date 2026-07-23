import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const baseEnv = {
  ...process.env,
  DATABASE_URL: 'postgresql://localhost/test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'test',
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_CONSULTATION_PRICE_ID: 'price_test'
}

const loadEnv = (overrides: NodeJS.ProcessEnv) =>
  spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      "import('./src/config/env.ts').then(({ env }) => console.log(JSON.stringify(env)))"
    ],
    {
      cwd: process.cwd(),
      env: { ...baseEnv, ...overrides },
      encoding: 'utf8'
    }
  )

test('keeps the redirect origin separate from the CORS allowlist', () => {
  const result = loadEnv({
    NODE_ENV: 'production',
    FRONTEND_ORIGIN: 'https://asterism.pics',
    CORS_ORIGINS: 'https://asterism.pics,http://localhost:5173'
  })

  assert.equal(result.status, 0, result.stderr)
  const env = JSON.parse(result.stdout)
  assert.equal(env.frontendOrigin, 'https://asterism.pics')
  assert.deepEqual(env.corsOrigins, [
    'https://asterism.pics',
    'http://localhost:5173'
  ])
})

test('rejects ambiguous or local production redirect origins', () => {
  for (const frontendOrigin of [
    'https://asterism.pics,http://localhost:5173',
    'http://localhost:5173'
  ]) {
    const result = loadEnv({
      NODE_ENV: 'production',
      FRONTEND_ORIGIN: frontendOrigin,
      CORS_ORIGINS: ''
    })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /FRONTEND_ORIGIN/)
  }
})
