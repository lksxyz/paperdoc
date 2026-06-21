import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";

export interface PaperdocConfig {
  port: number;
  models: {
    asr_live: string;
    asr_batch: string;
    diarization: string;
    llm: string;
  };
  ui: {
    theme: "light" | "dark";
    language: string;
  };
  download: {
    auto_download: boolean;
    parallel: boolean;
  };
}

const DEFAULT_CONFIG: PaperdocConfig = {
  port: 7321,
  models: {
    asr_live: "WHISPER_TINY",
    asr_batch: "PARAKEET_TDT_0_6B_V3_Q8_0",
    diarization: "PARAKEET_SORTFORMER_4SPK_V1_Q8_0",
    llm: "QWEN3_4B_Q4_K_M",
  },
  ui: {
    theme: "light",
    language: "en",
  },
  download: {
    auto_download: true,
    parallel: false,
  },
};

export const PAPERDOC_DIR = join(homedir(), ".paperdoc");
export const PAPERDOC_MODELS_DIR = join(PAPERDOC_DIR, "models");
export const PAPERDOC_DATA_DIR = join(PAPERDOC_DIR, "data");
export const PAPERDOC_DB_PATH = join(PAPERDOC_DATA_DIR, "data.db");
export const QVAC_MODELS_DIR = join(homedir(), ".qvac", "models");

export function ensureDirs() {
  [PAPERDOC_DIR, PAPERDOC_MODELS_DIR, PAPERDOC_DATA_DIR].forEach((dir) => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  });
}

export function loadConfig(): PaperdocConfig {
  ensureDirs();
  const configPath = join(PAPERDOC_DIR, "config.yml");

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = YAML.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function getModelPath(configValue: string): string | undefined {
  if (configValue.startsWith("/")) {
    return existsSync(configValue) ? configValue : undefined;
  }

  const paperdocPath = join(PAPERDOC_MODELS_DIR, configValue);
  if (existsSync(paperdocPath)) return paperdocPath;

  const qvacPath = join(QVAC_MODELS_DIR, configValue);
  if (existsSync(qvacPath)) return qvacPath;

  if (/^[A-Z][A-Z0-9_]+$/.test(configValue)) {
    return configValue;
  }

  return undefined;
}
