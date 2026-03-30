import { afterEach, describe, expect, it } from "vitest";
import {
  buildVersionSuggestion,
  detectVersionSuggestions,
  parseChangedFilesFromGit,
  parseNumstatOutput,
  readVersionManifest,
} from "../scripts/detect-version-increment.ts";
import {
  applyVersionBump,
  bumpVersionBlock,
  parseUpdateVersionArgs,
} from "../scripts/update-version.ts";
import {
  clearVersionInfoCache,
  formatVersionForBanner,
  formatVersionForLog,
  getBlockVersion,
  getFormattedVersion,
  getManifestSummary,
} from "../src/installer/version-info.ts";

const manifestPath = new URL("../version.manifest.json", import.meta.url).pathname;
const manifest = readVersionManifest(manifestPath);

describe("laia version detection", () => {
  it("ignores docs, tests, and context-only changes", () => {
    const result = detectVersionSuggestions(
      [
        { path: "context_Code/00-como-trabajan-las-ias.md", status: "M" },
        { path: "src/installer/executor.test.ts", status: "M" },
        { path: "docs/channels/README.md", status: "M" },
      ],
      new Map(),
      manifest,
    );

    expect(result.suggestions).toEqual([]);
    expect(result.ignored).toHaveLength(3);
  });

  it("suggests a minor bump when a new installer tool is added", () => {
    const suggestion = buildVersionSuggestion(
      "A",
      [{ path: "src/installer/tools/vpn-health.ts", status: "A" }],
      new Map([["src/installer/tools/vpn-health.ts", { additions: 120, deletions: 0 }]]),
      manifest,
    );

    expect(suggestion).toMatchObject({
      block: "A",
      level: "minor",
      current: "2.3.0",
      suggested: "2.4.0",
      confidence: "HIGH",
    });
  });

  it("suggests a patch bump for a focused installer fix", () => {
    const suggestion = buildVersionSuggestion(
      "A",
      [{ path: "src/installer/bootstrap.ts", status: "M" }],
      new Map([["src/installer/bootstrap.ts", { additions: 14, deletions: 6 }]]),
      manifest,
    );

    expect(suggestion).toMatchObject({
      block: "A",
      level: "patch",
      suggested: "2.3.1",
    });
  });

  it("suggests a major bump for broad executor architecture changes", () => {
    const suggestion = buildVersionSuggestion(
      "A",
      [
        { path: "src/installer/executor.ts", status: "M" },
        { path: "src/installer/index.ts", status: "M" },
        { path: "src/installer/agentic.ts", status: "A" },
        { path: "src/installer/types.ts", status: "M" },
      ],
      new Map([
        ["src/installer/executor.ts", { additions: 120, deletions: 60 }],
        ["src/installer/index.ts", { additions: 40, deletions: 20 }],
        ["src/installer/agentic.ts", { additions: 90, deletions: 0 }],
        ["src/installer/types.ts", { additions: 15, deletions: 10 }],
      ]),
      manifest,
    );

    expect(suggestion).toMatchObject({
      block: "A",
      level: "major",
      suggested: "3.0.0",
    });
  });

  it("suggests a minor bump for a new Nemo capability", () => {
    const suggestion = buildVersionSuggestion(
      "B",
      [{ path: "src/nemo/channels/voice.ts", status: "A" }],
      new Map([["src/nemo/channels/voice.ts", { additions: 98, deletions: 0 }]]),
      manifest,
    );

    expect(suggestion).toMatchObject({
      block: "B",
      level: "minor",
      current: "1.0.0",
      suggested: "1.1.0",
    });
  });

  it("parses git diff outputs with renames and numstat lines", () => {
    expect(parseChangedFilesFromGit("R100\told.ts\tnew.ts\nM\tsrc/installer/index.ts\n")).toEqual([
      { path: "new.ts", status: "R100" },
      { path: "src/installer/index.ts", status: "M" },
    ]);

    expect(parseNumstatOutput("10\t2\tsrc/installer/index.ts\n-\t-\tbinary.dat\n")).toEqual(
      new Map([
        ["src/installer/index.ts", { additions: 10, deletions: 2 }],
        ["binary.dat", { additions: 0, deletions: 0 }],
      ]),
    );
  });
});

describe("laia version updates", () => {
  it("bumps versions and updates manifest metadata", () => {
    const result = applyVersionBump(manifest, {
      block: "A",
      bumpType: "minor",
      setChanges: ["Nueva herramienta de rescate"],
      setContributors: ["Codex", "Claude"],
      setDescription: "Installer with stronger AI-guided recovery",
    });

    expect(result.oldVersion).toBe("2.3.0");
    expect(result.newVersion).toBe("2.4.0");
    expect(result.manifest.blocks.A.changes).toEqual(["Nueva herramienta de rescate"]);
    expect(result.manifest.blocks.A.contributors).toEqual(["Codex", "Claude"]);
    expect(result.manifest.blocks.A.description).toBe("Installer with stronger AI-guided recovery");
  });

  it("parses optional metadata arguments", () => {
    expect(
      parseUpdateVersionArgs([
        "--block",
        "B",
        "--bump",
        "patch",
        "--set-changes",
        "Fix 1;Fix 2",
        "--set-contributors",
        "Codex, Claude",
        "--set-description",
        "Updated ecosystem",
      ]),
    ).toEqual({
      block: "B",
      bumpType: "patch",
      setChanges: ["Fix 1", "Fix 2"],
      setContributors: ["Codex", "Claude"],
      setDescription: "Updated ecosystem",
    });
  });

  it("bumps an individual block without mutating the original one", () => {
    const original = manifest.blocks.B;
    const next = bumpVersionBlock(original, "patch");

    expect(next).toMatchObject({ major: 1, minor: 0, patch: 1 });
    expect(original).toMatchObject({ major: 1, minor: 0, patch: 0 });
  });
});

describe("laia runtime version info", () => {
  afterEach(() => {
    delete process.env.LAIA_ARCH_VERSION_MANIFEST_PATH;
    clearVersionInfoCache();
  });

  it("formats banner and log output from the manifest", () => {
    process.env.LAIA_ARCH_VERSION_MANIFEST_PATH = manifestPath;
    clearVersionInfoCache();

    expect(getFormattedVersion()).toBe("LAIA A:2.3.0 B:1.0.0");
    expect(formatVersionForBanner()).toBe("LAIA A:2.3.0 B:1.0.0");
    expect(getBlockVersion("A")).toBe("2.3.0");
    expect(getManifestSummary()).toMatchObject({
      blockA: "2.3.0",
      blockB: "1.0.0",
      compilationDate: "2026.3.29",
      buildNumber: 719,
    });
    expect(formatVersionForLog()).toBe("Laia Arch A:2.3.0 B:1.0.0 (build 719) compiled 2026.3.29");
  });
});
