import { Hono } from 'hono'

export interface TranscriptionResponse {
  readonly text: string
}

const QVAC_API_URL = process.env['QVAC_API_URL'] ?? 'http://localhost:11434'
const QVAC_MODEL = process.env['QVAC_MODEL'] ?? 'whisper'

export const makeTranscriptionApp = () => {
  const app = new Hono()

  app.post('/transcribe', async (c) => {
    try {
      const body = await c.req.parseBody()
      const file = body['file']

      if (!file || !(file instanceof File)) {
        return c.json({ error: 'No file provided' }, 400)
      }

      const formData = new FormData()
      formData.append('file', file, file.name)
      formData.append('model', QVAC_MODEL)
      formData.append('response_format', 'json')

      const response = await fetch(`${QVAC_API_URL}/v1/audio/transcriptions`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorText = await response.text()
        return c.json({ error: `QVAC transcription failed: ${errorText}` }, 502)
      }

      const data = (await response.json()) as TranscriptionResponse
      return c.json(data)
    } catch (error) {
      return c.json({ error: 'Transcription failed' }, 500)
    }
  })

  return app
}

export type TranscriptionRoute = { app: Hono }
