import { defineSsrMiddleware } from '#q-app/wrappers'
import type { Request, Response } from 'express'
import axios, { AxiosError } from 'axios'

const { GOOGLE_API_KEY } = process.env

if (!GOOGLE_API_KEY) {
  throw new Error('Missing GOOGLE_API_KEY in environment variables')
}

const fetchGoogleDriveFile = async (fileId: string, res: Response) => {
  try {
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
      res.status(500).json({ error: 'Failed to fetch file' })
    }
  }
}

const handleProxyRequest = async (req: Request, res: Response) => {
  const fileId = req.params.fileId

  if (!fileId) {
    return res.status(400).json({ error: 'Missing fileId parameter' })
  }

  await fetchGoogleDriveFile(fileId, res)
}

export default defineSsrMiddleware(async ({ app }) => {
  console.log('prepare gdrive proxy')
  app.get('/proxy/gdrive/:fileId', handleProxyRequest)
})
