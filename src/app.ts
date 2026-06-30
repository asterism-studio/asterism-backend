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
import { createConsultationCheckoutService } from './modules/consultation/service.js'
import { createPaymentRepository } from './modules/payments/repository.js'
import {
  createPaymentCheckoutService,
  createStripeCheckoutGateway
} from './modules/payments/service.js'

export const app = express()

const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})
const stripe = new Stripe(env.stripeSecretKey)
const consultationRepository = createConsultationRepository(prisma)
const paymentService = createPaymentCheckoutService({
  stripe: createStripeCheckoutGateway(stripe),
  payments: createPaymentRepository(prisma),
  stripePriceId: env.stripeConsultationPriceId,
  successUrl: new URL(
    env.stripeCheckoutSuccessPath,
    env.frontendOrigin
  ).toString(),
  cancelUrl: new URL(
    env.stripeCheckoutCancelPath,
    env.frontendOrigin
  ).toString()
})
const checkout = createConsultationCheckoutService({
  consultations: consultationRepository,
  payments: paymentService,
  now: () => new Date()
})
const consultationRouter = createConsultationRouter({
  authVerifier: createSupabaseAuthVerifier(supabase),
  checkout,
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
