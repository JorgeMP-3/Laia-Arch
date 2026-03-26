// presets/index.ts — Guardar, listar y cargar configuraciones de instalación
//
// Dos fuentes de presets, consultadas en este orden:
//   1. presets/ en la raíz del proyecto (predefinidos del repositorio)
//   2. ~/.laia-arch/presets/ (guardados por el usuario tras una instalación)
//
// Cuando un preset del repositorio tiene serverIp vacía, se rellena
// automáticamente con la IP detectada en el último escaneo guardado
// en ~/.laia-arch/last-scan.json.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { InstallerConfig } from "../types.js";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface PresetMetadata {
  name: string;
  description: string;
  createdAt: string; // ISO 8601
}

export interface SavedPreset extends PresetMetadata {
  config: InstallerConfig;
  /** Origen del preset: "repo" = incluido en el repositorio, "user" = guardado por el usuario. */
  source?: "repo" | "user";
}

// ── Rutas ──────────────────────────────────────────────────────────────────────

// presets/ del repositorio: mismo patrón que install-prompts/
const REPO_PRESETS_DIR = path.resolve(process.cwd(), "presets");

// presets/ del usuario: persisten en el home
const USER_PRESETS_DIR = path.join(os.homedir(), ".laia-arch", "presets");

// último escaneo guardado
const LAST_SCAN_FILE = path.join(os.homedir(), ".laia-arch", "last-scan.json");

// ── Helpers internos ───────────────────────────────────────────────────────────

function ensureUserPresetsDir(): void {
  fs.mkdirSync(USER_PRESETS_DIR, { recursive: true });
}

/** Convierte un nombre libre en un nombre de archivo seguro. */
function toFileName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_") + ".json"
  );
}

/** Lee la IP del servidor del último escaneo guardado, o devuelve undefined. */
function readLastScanIp(): string | undefined {
  try {
    const raw = fs.readFileSync(LAST_SCAN_FILE, "utf8");
    const parsed = JSON.parse(raw) as { scan?: { network?: { localIp?: string } } };
    return parsed?.scan?.network?.localIp || undefined;
  } catch {
    return undefined;
  }
}

/** Lee todos los archivos .json de un directorio como presets. */
function readPresetsFromDir(dir: string, source: "repo" | "user"): SavedPreset[] {
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          const raw = fs.readFileSync(path.join(dir, f), "utf8");
          const preset = JSON.parse(raw) as SavedPreset;
          return [{ ...preset, source }];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/**
 * Si el preset viene del repositorio y su serverIp está vacía,
 * la rellena con la IP del último escaneo.
 */
function fillServerIp(preset: SavedPreset): SavedPreset {
  if (preset.source !== "repo") {
    return preset;
  }
  if (preset.config.network && !preset.config.network.serverIp) {
    const ip = readLastScanIp();
    if (ip) {
      return {
        ...preset,
        config: {
          ...preset.config,
          network: { ...preset.config.network, serverIp: ip },
        },
      };
    }
  }
  return preset;
}

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * Guarda un preset en el directorio del usuario (~/.laia-arch/presets/).
 * Devuelve la ruta absoluta del archivo creado.
 */
export function savePreset(name: string, description: string, config: InstallerConfig): string {
  ensureUserPresetsDir();
  const preset: SavedPreset = {
    name,
    description,
    createdAt: new Date().toISOString(),
    config,
  };
  const filePath = path.join(USER_PRESETS_DIR, toFileName(name));
  fs.writeFileSync(filePath, JSON.stringify(preset, null, 2), { mode: 0o600 });
  return filePath;
}

/**
 * Devuelve todos los presets disponibles.
 * Los predefinidos del repositorio van primero; los del usuario van después,
 * ordenados por fecha de creación (más reciente primero dentro de cada grupo).
 */
export function listPresets(): SavedPreset[] {
  const repoPresets = readPresetsFromDir(REPO_PRESETS_DIR, "repo");
  const userPresets = readPresetsFromDir(USER_PRESETS_DIR, "user").toSorted((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return [...repoPresets, ...userPresets];
}

/**
 * Carga un preset por nombre.
 * Búsqueda en orden: repo → usuario.
 * Primero busca coincidencia exacta; si no la encuentra, busca coincidencia
 * parcial (case-insensitive).
 * Cuando el serverIp de un preset del repositorio está vacío, lo rellena
 * con la IP del último escaneo guardado.
 * Devuelve undefined si no hay ninguna coincidencia.
 */
export function loadPreset(name: string): SavedPreset | undefined {
  const all = listPresets();
  const lower = name.toLowerCase();

  const match =
    all.find((p) => p.name === name) ?? all.find((p) => p.name.toLowerCase().includes(lower));

  if (!match) {
    return undefined;
  }
  return fillServerIp(match);
}
