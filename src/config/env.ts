import dotenv from 'dotenv'

dotenv.config({ quiet: true })

const parsePort = (value: string | undefined): number => {
  const port = Number(value ?? 3001)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }

  return port
}

const requireEnv = (key: string): string => {
  const value = process.env[key]

  if (!value) {
    throw new Error(`${key} is required.`)
  }

  return value
}

const parseFrontendOrigin = (
  value: string | undefined,
  nodeEnv: string
): string => {
  const origin = (value ?? 'http://localhost:5173').trim()

  if (origin.includes(',')) {
    throw new Error('FRONTEND_ORIGIN must contain exactly one origin.')
  }

  const url = new URL(origin)
  if (nodeEnv === 'production' && url.hostname === 'localhost') {
    throw new Error('FRONTEND_ORIGIN must not use localhost in production.')
  }

  return origin
}

const nodeEnv = process.env.NODE_ENV ?? 'development'
const frontendOrigin = parseFrontendOrigin(
  process.env.FRONTEND_ORIGIN,
  nodeEnv
)

export const env = {
  nodeEnv,
  port: parsePort(process.env.PORT),
  frontendOrigin,
  corsOrigins: (process.env.CORS_ORIGINS || frontendOrigin)
    .split(',')
    .map(origin => origin.trim()),
  databaseUrl: requireEnv('DATABASE_URL'),
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseAnonKey: requireEnv('SUPABASE_ANON_KEY'),
  stripeSecretKey: requireEnv('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: requireEnv('STRIPE_WEBHOOK_SECRET'),
  stripeConsultationPriceId: requireEnv('STRIPE_CONSULTATION_PRICE_ID'),
  stripeCheckoutSuccessPath: process.env.STRIPE_CHECKOUT_SUCCESS_PATH ?? '/consultant?payment=success',
  stripeCheckoutCancelPath: process.env.STRIPE_CHECKOUT_CANCEL_PATH ?? '/consultant?payment=cancel',
}
