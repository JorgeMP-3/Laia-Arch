export interface VersionManifestBlock {
  major: number;
  minor: number;
  patch: number;
  description?: string;
  changes?: string[];
  lastUpdated?: string;
  contributors?: string[];
}

export interface ProjectVersionManifest {
  format?: string;
  blocks: {
    A: VersionManifestBlock;
    B: VersionManifestBlock;
  };
  compilationDate?: string;
  gitCommit?: string;
  buildNumber?: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isVersionManifestBlock(value: unknown): value is VersionManifestBlock {
  if (!value || typeof value !== "object") {
    return false;
  }

  const typed = value as Record<string, unknown>;
  return (
    isFiniteNumber(typed["major"]) &&
    isFiniteNumber(typed["minor"]) &&
    isFiniteNumber(typed["patch"])
  );
}

export function isProjectVersionManifest(value: unknown): value is ProjectVersionManifest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const typed = value as Record<string, unknown>;
  const blocks = typed["blocks"];
  if (!blocks || typeof blocks !== "object") {
    return false;
  }

  const typedBlocks = blocks as Record<string, unknown>;
  return isVersionManifestBlock(typedBlocks["A"]) && isVersionManifestBlock(typedBlocks["B"]);
}

export function formatBlockVersion(block: VersionManifestBlock): string {
  return `${block.major}.${block.minor}.${block.patch}`;
}

export function formatPrimaryVersionFromManifest(manifest: ProjectVersionManifest): string {
  return formatBlockVersion(manifest.blocks.A);
}

export function formatEcosystemVersionFromManifest(manifest: ProjectVersionManifest): string {
  return `A:${formatBlockVersion(manifest.blocks.A)} B:${formatBlockVersion(manifest.blocks.B)}`;
}

export function formatBannerVersionFromManifest(manifest: ProjectVersionManifest): string {
  return `LAIA ${formatEcosystemVersionFromManifest(manifest)}`;
}
