import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@Paperdoc/api/context";
import { appRouter } from "@Paperdoc/api/routers/index";
import { auth } from "@Paperdoc/auth";
import { env } from "@Paperdoc/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { transcribeAudio } from "./transcription";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  }),
);

app.post("/transcribe", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch (err) {
    return c.json(
      {
        error:
          err instanceof Error
            ? `Could not parse multipart body: ${err.message}`
            : "Could not parse multipart body",
      },
      400,
    );
  }

  const audio = body.audio;
  if (!(audio instanceof File)) {
    return c.json({ error: "multipart field 'audio' is required" }, 400);
  }
  if (audio.size === 0) {
    return c.json({ error: "audio file is empty" }, 400);
  }

  const buffer = Buffer.from(await audio.arrayBuffer());
  try {
    const { text, durationMs } = await transcribeAudio(buffer);
    return c.json({ text, durationMs });
  } catch (err) {
    console.error("[transcribe] failed:", err);
    return c.json(
      {
        error: err instanceof Error ? err.message : "transcription failed",
      },
      500,
    );
  }
});

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
