// presets/index.ts — Guardar, listar y cargar configuraciones de instalación
//
// Los presets se guardan en ~/.laia-arch/presets/<nombre-sanitizado>.json
// Cada preset contiene una InstallerConfig completa más metadatos.

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
}

// ── Ruta de almacenamiento ─────────────────────────────────────────────────────

const PRESETS_DIR = path.join(os.homedir(), ".laia-arch", "presets");

function ensurePresetsDir(): void {
  fs.mkdirSync(PRESETS_DIR, { recursive: true });
}

/** Convierte un nombre libre en un nombre de archivo seguro. */
function toFileName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_") + ".json";
}

// ── Operaciones ────────────────────────────────────────────────────────────────

/**
 * Guarda un preset en disco.
 * Devuelve la ruta absoluta del archivo creado.
 */
export function savePreset(
  name: string,
  description: string,
  config: InstallerConfig,
): string {
  ensurePresetsDir();
  const preset: SavedPreset = {
    name,
    description,
    createdAt: new Date().toISOString(),
    config,
  };
  const filePath = path.join(PRESETS_DIR, toFileName(name));
  fs.writeFileSync(filePath, JSON.stringify(preset, null, 2), { mode: 0o600 });
  return filePath;
}

/** Devuelve todos los presets guardados, ordenados por fecha de creación (más reciente primero). */
export function listPresets(): SavedPreset[] {
  try {
    if (!fs.existsSync(PRESETS_DIR)) return [];
    return fs
      .readdirSync(PRESETS_DIR)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          const raw = fs.readFileSync(path.join(PRESETS_DIR, f), "utf8");
          return [JSON.parse(raw) as SavedPreset];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

/**
 * Carga un preset por nombre.
 * Primero busca coincidencia exacta; si no la encuentra, busca coincidencia
 * parcial (case-insensitive) y devuelve el primero que encuentre.
 * Devuelve undefined si no hay ninguna coincidencia.
 */
export function loadPreset(name: string): SavedPreset | undefined {
  const presets = listPresets();
  const exact = presets.find((p) => p.name === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return presets.find((p) => p.name.toLowerCase().includes(lower));
}
