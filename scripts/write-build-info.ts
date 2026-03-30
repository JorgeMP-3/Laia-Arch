import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatEcosystemVersionFromManifest,
  formatPrimaryVersionFromManifest,
  isProjectVersionManifest,
} from "../src/version-manifest.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const pkgPath = path.join(rootDir, "package.json");
const manifestPath = path.join(rootDir, "version.manifest.json");

const readPackageVersion = () => {
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
};

const readManifestVersion = () => {
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isProjectVersionManifest(parsed)) {
      return null;
    }
    return {
      version: formatPrimaryVersionFromManifest(parsed),
      ecosystemVersion: formatEcosystemVersionFromManifest(parsed),
      compilationDate: parsed.compilationDate ?? null,
      buildNumber: parsed.buildNumber ?? null,
    };
  } catch {
    return null;
  }
};

const resolveCommit = () => {
  const envCommit = process.env.GIT_COMMIT?.trim() || process.env.GIT_SHA?.trim();
  if (envCommit) {
    return envCommit;
  }
  try {
    return execSync("git rev-parse HEAD", {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

const manifestVersion = readManifestVersion();
const version = manifestVersion?.version ?? readPackageVersion();
const commit = resolveCommit();

const buildInfo = {
  version,
  ecosystemVersion: manifestVersion?.ecosystemVersion ?? null,
  compilationDate: manifestVersion?.compilationDate ?? null,
  buildNumber: manifestVersion?.buildNumber ?? null,
  commit,
  builtAt: new Date().toISOString(),
};

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
