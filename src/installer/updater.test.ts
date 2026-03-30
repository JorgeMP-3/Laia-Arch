import { beforeEach, describe, expect, it, vi } from "vitest";

const execCalls: string[] = [];
const existingPaths = new Set<string>();
let runtimeResponds = true;

let verifyInstalledArtifacts: typeof import("./updater.js").verifyInstalledArtifacts;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  execCalls.length = 0;
  existingPaths.clear();
  runtimeResponds = true;

  vi.doMock("node:child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:child_process")>();
    const execSync = vi.fn((command: string) => {
      execCalls.push(command);

      const pathCheckMatch = command.match(/^test -e "(.+)" && echo ok$/);
      if (pathCheckMatch) {
        return existingPaths.has(pathCheckMatch[1]) ? "ok\n" : "";
      }

      const versionCheckMatch = command.match(
        /^node "(.+\/laia-arch\.mjs)" --version >\/dev\/null 2>&1 && echo ok$/,
      );
      if (versionCheckMatch) {
        return runtimeResponds ? "ok\n" : "";
      }

      return "";
    });

    return {
      ...actual,
      execSync,
    };
  });

  ({ verifyInstalledArtifacts } = await import("./updater.js"));
});

describe("installer updater", () => {
  it("fails when a required artifact is missing after build", () => {
    existingPaths.add("/repo/laia-arch.mjs");
    existingPaths.add("/repo/dist");
    existingPaths.add("/repo/install-prompts");

    expect(() => verifyInstalledArtifacts("/repo")).toThrow(
      "Instalación incompleta tras build. Faltan: /repo/install-prompts/00-system-context.md",
    );
    expect(execCalls).toEqual(
      expect.arrayContaining([
        'test -e "/repo/laia-arch.mjs" && echo ok',
        'test -e "/repo/dist" && echo ok',
        'test -e "/repo/install-prompts" && echo ok',
        'test -e "/repo/install-prompts/00-system-context.md" && echo ok',
      ]),
    );
  });

  it("fails when the installed runtime does not answer version after build", () => {
    existingPaths.add("/repo/laia-arch.mjs");
    existingPaths.add("/repo/dist");
    existingPaths.add("/repo/install-prompts");
    existingPaths.add("/repo/install-prompts/00-system-context.md");
    runtimeResponds = false;

    expect(() => verifyInstalledArtifacts("/repo")).toThrow(
      "El runtime instalado no responde a --version tras la actualización.",
    );
    expect(execCalls).toContain('node "/repo/laia-arch.mjs" --version >/dev/null 2>&1 && echo ok');
  });

  it("accepts an install tree when all required artifacts and runtime are present", () => {
    existingPaths.add("/repo/laia-arch.mjs");
    existingPaths.add("/repo/dist");
    existingPaths.add("/repo/install-prompts");
    existingPaths.add("/repo/install-prompts/00-system-context.md");

    expect(() => verifyInstalledArtifacts("/repo")).not.toThrow();
  });
});
