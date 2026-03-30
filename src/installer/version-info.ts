// version-info.ts — Read and format version information from manifest

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatBannerVersionFromManifest,
  formatBlockVersion,
  formatEcosystemVersionFromManifest,
  type ProjectVersionManifest as VersionManifest,
} from "../version-manifest.js";

let cachedManifest: VersionManifest | null = null;

function resolveManifestPath(): string {
  const overridePath = process.env.LAIA_ARCH_VERSION_MANIFEST_PATH;
  if (overridePath) {
    return path.resolve(overridePath);
  }

  // Try from current working directory first (where CLI is executed from)
  const cwdPath = path.join(process.cwd(), "version.manifest.json");
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  // Fallback: try from module location (works during development)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, "../../");
  const projectPath = path.join(projectRoot, "version.manifest.json");
  if (fs.existsSync(projectPath)) {
    return projectPath;
  }

  // Final fallback: return a default path (will be null in readManifest)
  return projectPath;
}

/**
 * Reads the version manifest from disk (cached after first read)
 */
function readManifest(): VersionManifest | null {
  if (cachedManifest) {
    return cachedManifest;
  }

  try {
    const manifestPath = resolveManifestPath();

    if (!fs.existsSync(manifestPath)) {
      return null;
    }

    const content = fs.readFileSync(manifestPath, "utf-8");
    cachedManifest = JSON.parse(content);
    return cachedManifest;
  } catch {
    return null;
  }
}

/**
 * Get the version string formatted as: LAIA A:X.Y.Z B:X.Y.Z
 */
export function getFormattedVersion(): string | null {
  const manifest = readManifest();
  if (!manifest) {
    return null;
  }

  return formatBannerVersionFromManifest(manifest);
}

/**
 * Get a short version string for display
 */
export function getShortVersion(): string | null {
  const manifest = readManifest();
  if (!manifest) {
    return null;
  }

  return formatEcosystemVersionFromManifest(manifest);
}

/**
 * Get the full manifest object
 */
export function getManifest(): VersionManifest | null {
  return readManifest();
}

export function getManifestSummary(): {
  blockA: string;
  blockB: string;
  compilationDate: string;
  buildNumber: number;
  descriptionA: string;
  descriptionB: string;
} | null {
  const manifest = readManifest();
  if (!manifest) {
    return null;
  }

  return {
    blockA: formatBlockVersion(manifest.blocks.A),
    blockB: formatBlockVersion(manifest.blocks.B),
    compilationDate: manifest.compilationDate ?? "unknown",
    buildNumber: manifest.buildNumber ?? 0,
    descriptionA: manifest.blocks.A.description ?? "",
    descriptionB: manifest.blocks.B.description ?? "",
  };
}

/**
 * Get version info for a specific block
 */
export function getBlockVersion(block: "A" | "B"): string | null {
  const manifest = readManifest();
  if (!manifest) {
    return null;
  }

  return formatBlockVersion(manifest.blocks[block]);
}

/**
 * Get the compilation date
 */
export function getCompilationDate(): string | null {
  const manifest = readManifest();
  return manifest?.compilationDate || null;
}

/**
 * Get build number
 */
export function getBuildNumber(): number | null {
  const manifest = readManifest();
  return manifest?.buildNumber || null;
}

/**
 * Get git commit hash
 */
export function getGitCommit(): string | null {
  const manifest = readManifest();
  return manifest?.gitCommit || null;
}

/**
 * Format version for banner display
 * Example output: "LAIA A:2.3.0 B:1.0.0"
 */
export function formatVersionForBanner(): string | null {
  return getFormattedVersion();
}

/**
 * Get version info for logging
 * Example output: "Laia Arch A:2.3.0 B:1.0.0 (build 719) compiled 2026.3.29"
 */
export function formatVersionForLog(): string | null {
  const manifest = readManifest();
  if (!manifest) {
    return null;
  }

  return `Laia Arch A:${formatBlockVersion(manifest.blocks.A)} B:${formatBlockVersion(manifest.blocks.B)} (build ${manifest.buildNumber}) compiled ${manifest.compilationDate}`;
}

export function clearVersionInfoCache(): void {
  cachedManifest = null;
}
