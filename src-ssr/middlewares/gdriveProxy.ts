import { defineSsrMiddleware } from '#q-app/wrappers'
import type { Request, Response } from 'express'
import type { AxiosError } from 'axios'
import axios from 'axios'

const { GOOGLE_API_KEY } = process.env

const fetchGoogleDriveFile = async (fileId: string, res: Response) => {
  try {
    if (!GOOGLE_API_KEY) {
      console.error('Missing GOOGLE_API_KEY in environment variables')
      return res.status(500).json({ error: 'internal error' })
    }

    const fileMetadataResponse = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${GOOGLE_API_KEY}`,
      {
        /*headers: {
          Authorization: `Bearer ${GOOGLE_API_KEY}`,
        },*/
        responseType: 'stream', // Allows piping the response directly
      },
    )

    // Pipe the file stream directly to the response
    res.setHeader(
      'Content-Type',
      fileMetadataResponse.headers['content-type'] || 'application/octet-stream',
    )
    res.setHeader('Content-Disposition', `inline; filename="${fileId}"`)
    fileMetadataResponse.data.pipe(res)
  } catch (err) {
    const error = err as AxiosError
    if (error.response && error.response.status === 404) {
      res.status(404).json({ error: 'File not found on Google Drive' })
    } else {
      console.error('Error fetching file from Google Drive:', error)
      res.status(500).json({ error: 'internal error' })
    }
  }
}

const handleProxyRequest = async (req: Request, res: Response) => {
  const fileId = req.params.fileId

  const fileIdPattern = /^[a-zA-Z0-9_-]+$/
  if (!fileId || !fileIdPattern.test(fileId)) {
    return res.status(400).json({ error: 'Invalid fileId parameter' })
  }

  await fetchGoogleDriveFile(fileId, res)
}

export default defineSsrMiddleware(({ app }) => {
  console.log('prepare gdrive proxy')
  app.get('/proxy/gdrive/:fileId', handleProxyRequest)
})
