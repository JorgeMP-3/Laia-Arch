#!/usr/bin/env node
// update-version.ts — Updates version.manifest.json

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  VersionBlock,
  VersionBlockName,
  VersionBumpLevel,
  VersionManifest,
} from "./detect-version-increment.ts";

interface UpdateVersionArgs {
  block: VersionBlockName;
  bumpType: Exclude<VersionBumpLevel, "none">;
  setChanges: string[];
  setContributors: string[];
  setDescription: string | null;
}

function getToday(): string {
  const now = new Date();
  return `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`;
}

function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

export function versionToString(block: VersionBlock): string {
  return `${block.major}.${block.minor}.${block.patch}`;
}

export function bumpVersionBlock(
  block: VersionBlock,
  bumpType: Exclude<VersionBumpLevel, "none">,
): VersionBlock {
  if (bumpType === "major") {
    return {
      ...block,
      major: block.major + 1,
      minor: 0,
      patch: 0,
    };
  }

  if (bumpType === "minor") {
    return {
      ...block,
      minor: block.minor + 1,
      patch: 0,
    };
  }

  return {
    ...block,
    patch: block.patch + 1,
  };
}

export function applyVersionBump(
  manifest: VersionManifest,
  args: UpdateVersionArgs,
): {
  manifest: VersionManifest;
  oldVersion: string;
  newVersion: string;
} {
  const currentBlock = manifest.blocks[args.block];
  const nextBlock = bumpVersionBlock(currentBlock, args.bumpType);
  const now = getToday();

  if (args.setChanges.length > 0) {
    nextBlock.changes = args.setChanges;
  }
  if (args.setContributors.length > 0) {
    nextBlock.contributors = args.setContributors;
  }
  if (args.setDescription) {
    nextBlock.description = args.setDescription;
  }
  nextBlock.lastUpdated = now;

  const nextManifest: VersionManifest = {
    ...manifest,
    blocks: {
      ...manifest.blocks,
      [args.block]: nextBlock,
    },
    compilationDate: now,
    gitCommit: getGitCommit(),
  };

  return {
    manifest: nextManifest,
    oldVersion: versionToString(currentBlock),
    newVersion: versionToString(nextBlock),
  };
}

export function parseUpdateVersionArgs(args: string[]): UpdateVersionArgs {
  let block: VersionBlockName | null = null;
  let bumpType: Exclude<VersionBumpLevel, "none"> = "patch";
  let setChanges: string[] = [];
  let setContributors: string[] = [];
  let setDescription: string | null = null;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === "--block") {
      const value = args[index + 1];
      if (value === "A" || value === "B") {
        block = value;
      }
      index += 1;
      continue;
    }

    if (arg === "--bump") {
      const value = args[index + 1];
      if (value === "patch" || value === "minor" || value === "major") {
        bumpType = value;
      }
      index += 1;
      continue;
    }

    if (arg === "--set-changes") {
      setChanges = (args[index + 1] ?? "")
        .split(";")
        .map((change) => change.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (arg === "--set-contributors") {
      setContributors = (args[index + 1] ?? "")
        .split(",")
        .map((contributor) => contributor.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (arg === "--set-description") {
      setDescription = (args[index + 1] ?? "").trim() || null;
      index += 1;
    }
  }

  if (!block) {
    throw new Error("Usage: update-version.ts --block A|B --bump major|minor|patch");
  }

  return {
    block,
    bumpType,
    setChanges,
    setContributors,
    setDescription,
  };
}

function main() {
  const args = parseUpdateVersionArgs(process.argv.slice(2));
  const manifestPath = path.resolve("version.manifest.json");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as VersionManifest;
  const result = applyVersionBump(manifest, args);

  fs.writeFileSync(manifestPath, JSON.stringify(result.manifest, null, 2) + "\n");

  console.log("✅ Version updated:");
  console.log(
    `   Block ${args.block}: ${result.oldVersion} → ${result.newVersion} (${args.bumpType})`,
  );
  console.log(`   Compilation date: ${result.manifest.compilationDate}`);
  console.log(`   Git commit: ${result.manifest.gitCommit}`);
  console.log(`\n   Written to: ${manifestPath}\n`);
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}
