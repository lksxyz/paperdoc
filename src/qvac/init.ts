import { join } from "node:path";
import { existsSync } from "node:fs";
import { PAPERDOC_MODELS_DIR, QVAC_MODELS_DIR, getModelPath } from "../config.js";
import { addEvent } from "./audit.js";

// Lazy imports to avoid loading QVAC SDK until needed
let qvacSdk: typeof import("@qvac/sdk") | null = null;

export async function getQvacSdk() {
  if (!qvacSdk) {
    qvacSdk = await import("@qvac/sdk");
  }
  return qvacSdk;
}

export interface ModelStatus {
  loaded: boolean;
  modelId?: string;
  type: string;
}

const loadedModels = new Map<string, ModelStatus>();

export async function loadModelByName(
  name: string,
  modelSrc: string | Record<string, unknown>,
  modelConfig?: Record<string, unknown>,
  modelType?: string
): Promise<string> {
  const sdk = await getQvacSdk();
  const existing = loadedModels.get(name);

  if (existing?.loaded && existing.modelId) {
    return existing.modelId;
  }

  // Resolve the actual path or constant; pass descriptor objects through unchanged
  const resolved =
    typeof modelSrc === "string"
      ? getModelPath(modelSrc) || modelSrc
      : modelSrc;

  const modelTypeLabel = typeof resolved === "string" ? resolved : (resolved as any).name ?? "descriptor";

  console.log(`  Loading model: ${name} (${modelTypeLabel})`);
  addEvent({ event: "model_load", model_name: name, model_type: modelTypeLabel, status: "start" });

  const loadOptions: any = {
    modelSrc: resolved,
    modelConfig,
    onProgress: (p: any) => {
      if (p.percentage < 100) {
        const mb = (n: number) => (n / 1e6).toFixed(1);
        process.stderr.write(
          process.stderr.isTTY
            ? `\r  ${name}: ${p.percentage.toFixed(0)}% (${mb(p.downloaded)}/${mb(p.total)} MB)`
            : `  ${name}: ${p.percentage.toFixed(0)}% (${mb(p.downloaded)}/${mb(p.total)} MB)\n`
        );
      } else {
        process.stderr.write(`\r  ${name}: loaded\n`);
      }
    },
  };

  if (modelType) {
    loadOptions.modelType = modelType;
  }

  const loadStart = Date.now();
  let modelId: string;
  try {
    modelId = await sdk.loadModel(loadOptions);
  } catch (err) {
    addEvent({ event: "model_load", model_name: name, model_type: modelTypeLabel, status: "error", duration_ms: Date.now() - loadStart, error: String(err) });
    throw err;
  }
  addEvent({ event: "model_load", model_name: name, model_type: modelTypeLabel, status: "success", duration_ms: Date.now() - loadStart });

  loadedModels.set(name, { loaded: true, modelId, type: modelTypeLabel });
  return modelId;
}

export async function unloadModelByName(name: string): Promise<void> {
  const sdk = await getQvacSdk();
  const existing = loadedModels.get(name);

  if (existing?.loaded && existing.modelId) {
    addEvent({ event: "model_unload", model_name: name, model_type: existing.type, status: "start" });
    const start = Date.now();
    await sdk.unloadModel({ modelId: existing.modelId });
    addEvent({ event: "model_unload", model_name: name, model_type: existing.type, status: "success", duration_ms: Date.now() - start });
    loadedModels.delete(name);
  }
}

export async function unloadAllModels(): Promise<void> {
  const sdk = await getQvacSdk();
  for (const [name, status] of loadedModels) {
    if (status.modelId) {
      const start = Date.now();
      addEvent({ event: "model_unload", model_name: name, model_type: status.type, status: "start" });
      await sdk.unloadModel({ modelId: status.modelId }).catch(() => {});
      addEvent({ event: "model_unload", model_name: name, model_type: status.type, status: "success", duration_ms: Date.now() - start });
    }
  }
  loadedModels.clear();
}

export function getLoadedModels(): Map<string, ModelStatus> {
  return new Map(loadedModels);
}

export function closeSdk(): Promise<void> {
  if (qvacSdk) {
    return qvacSdk.close();
  }
  return Promise.resolve();
}
