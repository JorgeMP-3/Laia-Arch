// version-info.ts — Read and format version information from manifest

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

interface VersionManifest {
  format: string;
  blocks: {
    A: VersionBlock;
    B: VersionBlock;
  };
  compilationDate: string;
  gitCommit: string;
  buildNumber: number;
}

interface VersionBlock {
  major: number;
  minor: number;
  patch: number;
  description: string;
  changes: string[];
  lastUpdated: string;
  contributors: string[];
}

let cachedManifest: VersionManifest | null = null;

function resolveManifestPath(): string {
  const overridePath = process.env.LAIA_ARCH_VERSION_MANIFEST_PATH;
  if (overridePath) {
    return path.resolve(overridePath);
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, "../../");
  return path.join(projectRoot, "version.manifest.json");
}

function formatBlockVersion(block: VersionBlock): string {
  return `${block.major}.${block.minor}.${block.patch}`;
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
 * Get the version string formatted as: LAIA A:X.Y B:X.Y YYYY.M.D
 */
export function getFormattedVersion(): string | null {
  const manifest = readManifest();
  if (!manifest) {
    return null;
  }

  const blockA = manifest.blocks.A;
  const blockB = manifest.blocks.B;

  return `LAIA A:${blockA.major}.${blockA.minor} B:${blockB.major}.${blockB.minor} ${manifest.compilationDate}`;
}

/**
 * Get a short version string for display
 */
export function getShortVersion(): string | null {
  const manifest = readManifest();
  if (!manifest) {
    return null;
  }

  const blockA = manifest.blocks.A;
  const blockB = manifest.blocks.B;

  return `A:${blockA.major}.${blockA.minor} B:${blockB.major}.${blockB.minor}`;
}

/**
 * Get the full manifest object
 */
export function getManifest(): VersionManifest | null {
  return readManifest();
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
 * Example output: "LAIA A:2.3 B:1.0 2026.3.29"
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
