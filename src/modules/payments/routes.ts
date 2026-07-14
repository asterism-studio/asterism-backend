import express, { Router } from 'express'
import type Stripe from 'stripe'

import { AppError } from '../../middleware/errorHandler.js'
import type { StripeWebhookHandler } from './types.js'

interface StripeWebhookRouterDependencies {
  stripe: Stripe
  webhookSecret: string
  handleWebhook: StripeWebhookHandler
}

export const createStripeWebhookRouter = (
  dependencies: StripeWebhookRouterDependencies
): Router => {
  const router = Router()

  router.post(
    '/',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      let event: Stripe.Event

      try {
        event = dependencies.stripe.webhooks.constructEvent(
          req.body,
          req.header('stripe-signature') ?? '',
          dependencies.webhookSecret
        )
      } catch {
        throw new AppError(
          400,
          'INVALID_STRIPE_SIGNATURE',
          'Stripe signature verification failed.'
        )
      }

      await dependencies.handleWebhook(
        event,
        JSON.parse(req.body.toString('utf8'))
      )

      res.json({ received: true })
    }
  )

  return router
}
