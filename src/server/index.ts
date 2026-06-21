import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apiRoutes } from "./api.js";
import { setupWs, handleWsMessage, cleanupWs } from "./websocket.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = join(__dirname, "..", "web");

const SHUTDOWN_TIMEOUT_MS = 60_000;
const SHUTDOWN_TICK_MS = 250;

let isShuttingDown = false;
let shutdownPromise: Promise<void> | null = null;
let bunServer: ReturnType<typeof Bun.serve> | null = null;
const inflightRequests = new Set<Promise<unknown>>();

export async function startServer(port: number) {
  const app = new Hono();

  app.route("/api", apiRoutes);
  app.use("/*", serveStatic({ root: webDir }));
  app.get("*", async (c) => c.html(await Bun.file(join(webDir, "index.html")).text()));

  bunServer = Bun.serve({
    port,
    // SOAP generation can run for several minutes on CPU; the default 10s
    // idle timeout kills the SSE stream. Allow long-lived connections.
    idleTimeout: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const success = srv.upgrade(req, { data: { type: "transcription" } });
        if (success) return undefined as any;
      }
      if (isShuttingDown) {
        return new Response(
          JSON.stringify({ error: "Server is shutting down" }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }
      const p = Promise.resolve(app.fetch(req)).finally(() => {
        inflightRequests.delete(p);
      });
      inflightRequests.add(p);
      return p;
    },
    websocket: {
      open(ws) { setupWs(ws as any); },
      message(ws, message) { handleWsMessage(ws as any, message); },
      close(ws) { cleanupWs(ws as any); },
    },
  });

  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));

  console.log(`  ✓ Server running at http://localhost:${port}`);
  console.log(`  ✓ Press Ctrl+C to stop (graceful shutdown)\n`);

  return bunServer;
}

async function gracefulShutdown(signal: string) {
  if (shutdownPromise) {
    console.log(`\n  ⚠ ${signal} received again — forcing exit.`);
    process.exit(1);
  }
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n  ⏳ ${signal} received — shutting down gracefully…`);

  shutdownPromise = (async () => {
    const startedAt = Date.now();

    try {
      bunServer?.stop();
    } catch (err) {
      console.log(`  ⚠ Failed to stop accepting connections: ${err}`);
    }

    if (inflightRequests.size > 0) {
      console.log(`  ⏳ Waiting for ${inflightRequests.size} in-flight request(s) to finish…`);
    }
    while (inflightRequests.size > 0 && Date.now() - startedAt < SHUTDOWN_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, SHUTDOWN_TICK_MS));
      if (inflightRequests.size > 0) {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        console.log(`     still waiting — ${inflightRequests.size} left (${elapsed}s)`);
      }
    }

    if (inflightRequests.size > 0) {
      console.log(`  ⚠ Timeout: ${inflightRequests.size} request(s) still in flight after ${Math.round(SHUTDOWN_TIMEOUT_MS / 1000)}s.`);
    } else {
      console.log("  ✓ All in-flight requests completed");
    }

    try {
      const { unloadAllModels } = await import("../qvac/init.js");
      await unloadAllModels();
      console.log("  ✓ AI models unloaded");
    } catch (err) {
      console.log(`  ⚠ Failed to unload models: ${err}`);
    }

    try {
      const { closeDb } = await import("./db.js");
      closeDb();
      console.log("  ✓ Database closed");
    } catch (err) {
      console.log(`  ⚠ Failed to close database: ${err}`);
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`  ✓ Shutdown complete (${elapsed}s)\n`);
  })();

  try {
    await shutdownPromise;
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
