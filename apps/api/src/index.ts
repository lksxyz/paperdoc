import { serve } from '@hono/node-server'
import { Context, Effect, Layer } from 'effect'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { makeTranscriptionApp } from './routes/transcription'

const AppContext = Context.GenericTag<{ readonly port: number }>('AppContext')

const AppContextLive = Layer.succeed(AppContext, { port: 3000 })

const makeApp = Effect.gen(function* () {
  const { port } = yield* AppContext

  const app = new Hono()

  app.use('/*', cors())

  app.get('/', (c) => c.json({ message: 'Hello from Paperwish API!' }))

  app.get('/health', (c) => c.json({ status: 'ok' }))

  const transcriptionApp = makeTranscriptionApp()
  app.route('/api/v1', transcriptionApp)

  return { app, port }
})

const run = makeApp.pipe(
  Effect.tap(({ port }) =>
    Effect.sync(() => {
      console.log(`Server running on http://localhost:${port}`)
    })
  ),
  Effect.andThen(({ app, port }) =>
    Effect.sync(() => {
      serve({ fetch: app.fetch, port })
      return { app, port }
    })
  )
)

const program = run.pipe(Effect.provide(AppContextLive), Effect.scoped)

Effect.runPromise(program).catch(console.error)
