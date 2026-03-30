import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ORIGINAL_ENV = process.env.LAIA_ARCH_PROMPTS_DIR;

describe("prompt directory resolution", () => {
  afterEach(() => {
    if (ORIGINAL_ENV == null) {
      delete process.env.LAIA_ARCH_PROMPTS_DIR;
    } else {
      process.env.LAIA_ARCH_PROMPTS_DIR = ORIGINAL_ENV;
    }
  });

  it("prefers LAIA_ARCH_PROMPTS_DIR when the requested prompt exists there", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "laia-prompts-"));
    fs.writeFileSync(path.join(tmpDir, "00-system-context.md"), "prompt", "utf8");
    process.env.LAIA_ARCH_PROMPTS_DIR = tmpDir;

    const { getPromptCandidateDirs } = await import("./conversation.js");
    const candidates = getPromptCandidateDirs();

    expect(candidates[0]).toBe(tmpDir);
  });
});
