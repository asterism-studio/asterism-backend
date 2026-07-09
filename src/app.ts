// 負責 Express 設定

import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { env } from './config/env.js'
import { prisma } from './db/prisma.js'
import { errorHandler } from './middleware/errorHandler.js'
import { createSupabaseAuthVerifier } from './middleware/requireAuth.js'
import { createConsultationRepository } from './modules/consultation/repository.js'
import { createConsultationRouter } from './modules/consultation/routes.js'
import {
  createConsultationAvailabilityService,
  createConsultationCheckoutService,
  createConsultationQueryService
} from './modules/consultation/service.js'
import {
  createPaymentRepository,
  createStripeWebhookRepository
} from './modules/payments/repository.js'
import { createStripeWebhookRouter } from './modules/payments/routes.js'
import {
  createPaymentCheckoutService,
  createStripeCheckoutGateway
} from './modules/payments/service.js'
import { createStripeWebhookService } from './modules/payments/webhook-service.js'

export const app = express()

const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})
const stripe = new Stripe(env.stripeSecretKey)
const consultationRepository = createConsultationRepository(prisma)
const paymentRepository = createPaymentRepository(prisma)
const paymentService = createPaymentCheckoutService({
  stripe: createStripeCheckoutGateway(stripe),
  payments: paymentRepository,
  stripePriceId: env.stripeConsultationPriceId,
  successUrl: new URL(
    env.stripeCheckoutSuccessPath,
    env.frontendUrl
  ).toString(),
  cancelUrl: new URL(
    env.stripeCheckoutCancelPath,
    env.frontendUrl
  ).toString(),
  now: () => new Date()
})
const stripeWebhookRouter = createStripeWebhookRouter({
  stripe,
  webhookSecret: env.stripeWebhookSecret,
  handleWebhook: createStripeWebhookService({
    repository: createStripeWebhookRepository(prisma),
    now: () => new Date()
  })
})
const checkout = createConsultationCheckoutService({
  consultations: consultationRepository,
  payments: paymentService,
  now: () => new Date()
})
const consultationRouter = createConsultationRouter({
  authVerifier: createSupabaseAuthVerifier(supabase),
  checkout,
  getAvailability: createConsultationAvailabilityService({
    consultations: consultationRepository,
    now: () => new Date()
  }),
  getBooking: createConsultationQueryService(consultationRepository),
  rateLimit: {
    windowMs: 10 * 60 * 1000,
    limit: 5
  }
})

app.use(
  cors({
    origin: env.frontendOrigin,
    credentials: true
  })
)

app.use('/api/v1/payments/stripe/webhook', stripeWebhookRouter)
app.use(express.json())
app.use('/api/v1/consultations', consultationRouter)

// 沒使用 req 時用 _req
app.get('/api/v1/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'asterism-backend'
    },
    error: null
  })
})

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    data: null,
    error: {
      code: 'NOT_FOUND',
      message: 'API route not found.'
    }
  })
})

app.use(errorHandler)
