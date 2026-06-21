import { join } from "node:path";
import { existsSync } from "node:fs";
import { PAPERDOC_MODELS_DIR, QVAC_MODELS_DIR, getModelPath } from "../config.js";

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

  console.log(`  Loading model: ${name} (${typeof resolved === "string" ? resolved : resolved.name ?? "descriptor"})`);
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

  const modelId = await sdk.loadModel(loadOptions);

  loadedModels.set(name, { loaded: true, modelId, type: name });
  return modelId;
}

export async function unloadModelByName(name: string): Promise<void> {
  const sdk = await getQvacSdk();
  const existing = loadedModels.get(name);

  if (existing?.loaded && existing.modelId) {
    await sdk.unloadModel({ modelId: existing.modelId });
    loadedModels.delete(name);
  }
}

export async function unloadAllModels(): Promise<void> {
  const sdk = await getQvacSdk();
  for (const [name, status] of loadedModels) {
    if (status.modelId) {
      await sdk.unloadModel({ modelId: status.modelId }).catch(() => {});
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
