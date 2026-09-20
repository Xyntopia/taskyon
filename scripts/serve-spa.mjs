// Serves the built SPA with the production `_redirects` fallback: unknown navigation routes load
// index.html while file requests keep their real response status.
//
// Usage: node scripts/serve-spa.mjs [dist/spa] [port] [host]
import express from 'express'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'dist/spa')
const port = Number(process.argv[3] ?? process.env.PORT ?? 4000)
const host = process.argv[4] ?? process.env.HOST ?? '127.0.0.1'
const indexFile = join(root, 'index.html')

if (!existsSync(indexFile)) {
  console.error(`No index.html found in ${root}. Build the SPA first.`)
  process.exit(1)
}

const app = express()
app.use(express.static(root))
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()
  const accept = req.headers.accept ?? ''
  const navigates = accept.includes('text/html') || accept.includes('application/xhtml+xml')
  if (!navigates) return next()
  res.sendFile(indexFile)
})
app.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}/`)
})
