#!/usr/bin/env node
// detect-version-increment.ts — Detects code changes and suggests version increments

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type VersionBlockName = "A" | "B";
export type VersionBumpLevel = "none" | "patch" | "minor" | "major";
export type VersionConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface VersionBlock {
  major: number;
  minor: number;
  patch: number;
  description: string;
  changes: string[];
  lastUpdated: string;
  contributors: string[];
}

export interface VersionManifest {
  format: string;
  blocks: Record<VersionBlockName, VersionBlock>;
  compilationDate: string;
  gitCommit: string;
  buildNumber: number;
}

export interface ChangedFile {
  path: string;
  status: string;
}

export interface FileStat {
  additions: number;
  deletions: number;
}

export interface VersionSuggestion {
  block: VersionBlockName;
  current: string;
  suggested: string;
  level: VersionBumpLevel;
  confidence: VersionConfidence;
  reason: string;
  files: string[];
  additions: number;
  deletions: number;
}

interface BlockDefinition {
  label: string;
  include: RegExp[];
  majorSignals: RegExp[];
  minorSignals: RegExp[];
}

const BLOCK_DEFINITIONS: Record<VersionBlockName, BlockDefinition> = {
  A: {
    label: "Installer and setup engine",
    include: [
      /^src\/installer\/.+/,
      /^src\/cli\/laia-arch-theme\.ts$/,
      /^scripts\/detect-version-increment\.ts$/,
      /^scripts\/update-version\.ts$/,
    ],
    majorSignals: [
      /^src\/installer\/agentic\.ts$/,
      /^src\/installer\/conversation\.ts$/,
      /^src\/installer\/executor\.ts$/,
      /^src\/installer\/index\.ts$/,
      /^src\/installer\/plan-generator\.ts$/,
      /^src\/installer\/types\.ts$/,
    ],
    minorSignals: [
      /^src\/installer\/bootstrap\.ts$/,
      /^src\/installer\/credential-manager\.ts$/,
      /^src\/installer\/provisional-gateway\.ts$/,
      /^src\/installer\/tools\/.+/,
      /^src\/installer\/presets\/.+/,
      /^src\/installer\/version-info\.ts$/,
      /^scripts\/detect-version-increment\.ts$/,
      /^scripts\/update-version\.ts$/,
    ],
  },
  B: {
    label: "Agora, Nemo, and ecosystem surfaces",
    include: [
      /^src\/agora\/.+/,
      /^src\/nemo\/.+/,
      /^src\/provider-web\.ts$/,
      /^apps\/macos\/Sources\/.+\.swift$/,
    ],
    majorSignals: [/^src\/agora\/.+/, /^src\/nemo\/.+/, /^src\/provider-web\.ts$/],
    minorSignals: [/^src\/agora\/.+/, /^src\/nemo\/.+/, /^apps\/macos\/Sources\/.+\.swift$/],
  },
};

const NON_VERSION_PATTERNS = [
  /^docs\/.+/,
  /^context_LAIA\/.+/,
  /^context_Code\/.+/,
  /^\.github\/.+/,
  /^.*\.test\.(ts|tsx|js|mjs|cjs)$/,
  /^oxlint\.json$/,
  /^version\.manifest\.json$/,
];

export function resolveManifestPath(cwd = process.cwd()): string {
  return path.resolve(cwd, "version.manifest.json");
}

export function readVersionManifest(manifestPath = resolveManifestPath()): VersionManifest {
  return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as VersionManifest;
}

export function formatBlockVersion(block: VersionBlock): string {
  return `${block.major}.${block.minor}.${block.patch}`;
}

export function bumpVersionString(
  current: string,
  level: Exclude<VersionBumpLevel, "none">,
): string {
  const [major, minor, patch] = current.split(".").map((part) => Number.parseInt(part, 10) || 0);

  if (level === "major") {
    return `${major + 1}.0.0`;
  }
  if (level === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function matchesAny(filePath: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(filePath));
}

export function isNonVersionFile(filePath: string): boolean {
  return matchesAny(filePath, NON_VERSION_PATTERNS);
}

export function classifyVersionBlock(filePath: string): VersionBlockName | null {
  if (isNonVersionFile(filePath)) {
    return null;
  }

  if (matchesAny(filePath, BLOCK_DEFINITIONS.A.include)) {
    return "A";
  }
  if (matchesAny(filePath, BLOCK_DEFINITIONS.B.include)) {
    return "B";
  }
  return null;
}

export function groupFilesByBlock(files: ChangedFile[]): {
  blocks: Record<VersionBlockName, ChangedFile[]>;
  ignored: ChangedFile[];
  uncategorized: ChangedFile[];
} {
  const blocks: Record<VersionBlockName, ChangedFile[]> = { A: [], B: [] };
  const ignored: ChangedFile[] = [];
  const uncategorized: ChangedFile[] = [];

  for (const file of files) {
    const block = classifyVersionBlock(file.path);

    if (block) {
      blocks[block].push(file);
      continue;
    }

    if (isNonVersionFile(file.path)) {
      ignored.push(file);
      continue;
    }

    uncategorized.push(file);
  }

  return { blocks, ignored, uncategorized };
}

function sumFileStats(files: ChangedFile[], fileStats: Map<string, FileStat>): FileStat {
  let additions = 0;
  let deletions = 0;

  for (const file of files) {
    const stat = fileStats.get(file.path);
    if (!stat) {
      continue;
    }
    additions += stat.additions;
    deletions += stat.deletions;
  }

  return { additions, deletions };
}

function detectLevelForBlock(
  block: VersionBlockName,
  files: ChangedFile[],
  stats: FileStat,
): Pick<VersionSuggestion, "level" | "confidence" | "reason"> {
  const filePaths = files.map((file) => file.path);
  const definition = BLOCK_DEFINITIONS[block];
  const churn = stats.additions + stats.deletions;
  const hasAddedFile = files.some((file) => file.status.startsWith("A"));
  const touchesMajorSurface = filePaths.some((file) => matchesAny(file, definition.majorSignals));
  const touchesMinorSurface = filePaths.some((file) => matchesAny(file, definition.minorSignals));
  const multipleFiles = files.length >= 4;

  if (touchesMajorSurface && (churn >= 240 || (multipleFiles && hasAddedFile))) {
    return {
      level: "major",
      confidence: churn >= 320 ? "HIGH" : "MEDIUM",
      reason: `Cambio estructural en ${definition.label.toLowerCase()} (${files.length} archivos, ${churn} líneas tocadas)`,
    };
  }

  if (hasAddedFile || (touchesMinorSurface && stats.additions >= 40) || stats.additions >= 90) {
    return {
      level: "minor",
      confidence: hasAddedFile || touchesMinorSurface ? "HIGH" : "MEDIUM",
      reason: `Nueva capacidad o herramienta detectada en ${definition.label.toLowerCase()}`,
    };
  }

  return {
    level: "patch",
    confidence: "HIGH",
    reason: `Corrección o ajuste interno en ${definition.label.toLowerCase()}`,
  };
}

export function buildVersionSuggestion(
  block: VersionBlockName,
  files: ChangedFile[],
  fileStats: Map<string, FileStat>,
  manifest: VersionManifest,
): VersionSuggestion | null {
  if (files.length === 0) {
    return null;
  }

  const stats = sumFileStats(files, fileStats);
  const current = formatBlockVersion(manifest.blocks[block]);
  const decision = detectLevelForBlock(block, files, stats);

  if (decision.level === "none") {
    return {
      block,
      current,
      suggested: current,
      level: "none",
      confidence: decision.confidence,
      reason: decision.reason,
      files: files.map((file) => file.path),
      additions: stats.additions,
      deletions: stats.deletions,
    };
  }

  return {
    block,
    current,
    suggested: bumpVersionString(current, decision.level),
    level: decision.level,
    confidence: decision.confidence,
    reason: decision.reason,
    files: files.map((file) => file.path),
    additions: stats.additions,
    deletions: stats.deletions,
  };
}

export function detectVersionSuggestions(
  files: ChangedFile[],
  fileStats: Map<string, FileStat>,
  manifest: VersionManifest,
): {
  suggestions: VersionSuggestion[];
  ignored: ChangedFile[];
  uncategorized: ChangedFile[];
} {
  const grouped = groupFilesByBlock(files);
  const suggestions: VersionSuggestion[] = [];

  for (const block of ["A", "B"] as const) {
    const suggestion = buildVersionSuggestion(block, grouped.blocks[block], fileStats, manifest);
    if (suggestion) {
      suggestions.push(suggestion);
    }
  }

  return {
    suggestions,
    ignored: grouped.ignored,
    uncategorized: grouped.uncategorized,
  };
}

export function parseChangedFilesFromGit(diffOutput: string): ChangedFile[] {
  return diffOutput
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const columns = line.split("\t");
      const status = columns[0] ?? "M";
      const filePath = columns.at(-1) ?? "";
      return { path: filePath, status };
    })
    .filter((file) => file.path.length > 0);
}

export function parseNumstatOutput(numstatOutput: string): Map<string, FileStat> {
  const stats = new Map<string, FileStat>();

  for (const line of numstatOutput.trim().split("\n")) {
    if (!line) {
      continue;
    }

    const [rawAdditions = "0", rawDeletions = "0", filePath = ""] = line.split("\t");
    if (!filePath) {
      continue;
    }

    stats.set(filePath, {
      additions: rawAdditions === "-" ? 0 : Number.parseInt(rawAdditions, 10) || 0,
      deletions: rawDeletions === "-" ? 0 : Number.parseInt(rawDeletions, 10) || 0,
    });
  }

  return stats;
}

function getGitOutput(args: string[]): string {
  return execSync(`git ${args.join(" ")}`, {
    encoding: "utf-8",
  });
}

export function getChangedFilesSince(sinceRef: string): ChangedFile[] {
  const diffOutput = getGitOutput(["diff", "--name-status", "--find-renames", sinceRef, "--"]);
  return parseChangedFilesFromGit(diffOutput);
}

export function getFileStatsSince(sinceRef: string): Map<string, FileStat> {
  const numstatOutput = getGitOutput(["diff", "--numstat", "--find-renames", sinceRef, "--"]);
  return parseNumstatOutput(numstatOutput);
}

export function resolveSinceRef(args: string[]): string {
  if (args.includes("--since-commits")) {
    const value = args[args.indexOf("--since-commits") + 1] ?? "1";
    return `HEAD~${value}`;
  }

  if (args.includes("--since-tag")) {
    try {
      return getGitOutput(["describe", "--tags", "--abbrev=0"]).trim();
    } catch {
      return "HEAD~10";
    }
  }

  if (args.includes("--since")) {
    return args[args.indexOf("--since") + 1] ?? "HEAD~1";
  }

  return "HEAD~1";
}

function printHumanReadableResult(
  sinceRef: string,
  suggestions: VersionSuggestion[],
  ignored: ChangedFile[],
  uncategorized: ChangedFile[],
): void {
  console.log(`\n📊 Detecting version increments since: ${sinceRef}\n`);

  if (suggestions.length === 0) {
    console.log("✓ No version-affecting changes detected. No version increment needed.");
    if (ignored.length > 0) {
      console.log(`  Ignored files: ${ignored.length}`);
    }
    if (uncategorized.length > 0) {
      console.log(`  Uncategorized files: ${uncategorized.length}`);
    }
    console.log();
    return;
  }

  for (const suggestion of suggestions) {
    console.log(
      `📝 Block ${suggestion.block} changes detected (${suggestion.files.length} files):`,
    );
    for (const filePath of suggestion.files.slice(0, 5)) {
      console.log(`   - ${filePath}`);
    }
    if (suggestion.files.length > 5) {
      console.log(`   + ${suggestion.files.length - 5} more`);
    }
    console.log(
      `   Suggestion: ${suggestion.block}:${suggestion.current} → ${suggestion.block}:${suggestion.suggested} (${suggestion.level})`,
    );
    console.log(`   Confidence: ${suggestion.confidence}`);
    console.log(`   Reason: ${suggestion.reason}`);
    console.log(`   Diff stats: +${suggestion.additions} / -${suggestion.deletions}\n`);
  }

  if (ignored.length > 0) {
    console.log(`ℹ Ignored files with no version impact: ${ignored.length}`);
  }
  if (uncategorized.length > 0) {
    console.log(`ℹ Uncategorized files outside A/B blocks: ${uncategorized.length}`);
  }
  console.log();
}

function main() {
  const args = process.argv.slice(2);
  const sinceRef = resolveSinceRef(args);
  const manifest = readVersionManifest();
  const changedFiles = getChangedFilesSince(sinceRef);
  const fileStats = getFileStatsSince(sinceRef);
  const result = detectVersionSuggestions(changedFiles, fileStats, manifest);

  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          sinceRef,
          suggestions: result.suggestions,
          ignored: result.ignored,
          uncategorized: result.uncategorized,
        },
        null,
        2,
      ),
    );
    return;
  }

  printHumanReadableResult(sinceRef, result.suggestions, result.ignored, result.uncategorized);
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  main();
}
