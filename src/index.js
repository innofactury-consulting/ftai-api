import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'

import assetsRouter    from './routes/assets.js'
import diagnosisRouter from './routes/diagnosis.js'
import sapRouter       from './routes/sap.js'

const app  = express()
const PORT = process.env.PORT || 3000

app.use(helmet())
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }))
app.use(express.json({ limit: '1mb' }))
app.use(morgan('dev'))

app.use('/api/v1/assets',    assetsRouter)
app.use('/api/v1/diagnosis', diagnosisRouter)
app.use('/api/v1/sap',       sapRouter)

app.get('/health', (_, res) => res.json({
  status: 'ok',
  version: '1.0.0',
  ts: new Date().toISOString()
}))

app.get('/api/v1', (_, res) => res.json({
  name: 'FTAI API — Fault Tree Artificial Intelligence',
  version: '1.0.0',
  endpoints: [
    'GET  /api/v1/assets',
    'GET  /api/v1/assets/:id',
    'GET  /api/v1/assets/:id/fault-tree',
    'GET  /api/v1/assets/:id/symptoms',
    'GET  /api/v1/assets/:id/offline',
    'POST /api/v1/diagnosis',
    'GET  /api/v1/diagnosis/:id',
    'PATCH /api/v1/diagnosis/:id/confirm',
    'PATCH /api/v1/diagnosis/:id/discard',
    'GET  /api/v1/diagnosis/:id/sap-payload',
    'POST /api/v1/sap/sync',
    'GET  /api/v1/sap/pending'
  ]
}))

app.use((err, req, res, _next) => {
  console.error('[FTAI Error]', err.message)
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  })
})

app.listen(PORT, () => {
  console.log(`\n FTAI API running on http://localhost:${PORT}`)
  console.log(` Docs: http://localhost:${PORT}/api/v1\n`)
})

export default app
