// 負責 Express 設定

import express from 'express'
import cors from 'cors'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'

export const app = express()

app.use(
  cors({
    origin: env.frontendOrigin,
    credentials: true
  })
)

app.use(express.json())

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