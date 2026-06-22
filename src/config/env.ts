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

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parsePort(process.env.PORT),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: requireEnv('DATABASE_URL')
}
