import { defineSsrMiddleware } from '#q-app/wrappers'
import type { Request, Response } from 'express'
import { verifyExpressRequest } from 'src/modules/general_types'

const validateRequest = async (req: Request, res: Response) => {
  try {
    if (!(await verifyExpressRequest(req))) {
      return res.status(401).json({ error: 'Unable to verify request' })
    }

    console.log('Valid request:', req)
    res.json({ message: 'Valid request' })
  } catch (err) {
    console.error('Validation error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// "async" is optional;
// more info on params: https://v2.quasar.dev/quasar-cli/developing-ssr/ssr-middlewares
export default defineSsrMiddleware(({ app /*, resolveUrlPath, publicPath, render */ }) => {
  // something to do with the server "app"
  app.post('/validate', validateRequest)
  app.get('/validate', validateRequest)
})
