import { describe, expect, it } from "vitest";
import {
  ensureLaiaArchExecMarkerOnProcess,
  markLaiaArchExecEnv,
  LAIA_ARCH_CLI_ENV_VALUE,
  LAIA_ARCH_CLI_ENV_VAR,
} from "./laia-arch-exec-env.js";

describe("markLaiaArchExecEnv", () => {
  it("returns a cloned env object with the exec marker set", () => {
    const env = { PATH: "/usr/bin", LAIA_ARCH_CLI: "0" };
    const marked = markLaiaArchExecEnv(env);

    expect(marked).toEqual({
      PATH: "/usr/bin",
      LAIA_ARCH_CLI: LAIA_ARCH_CLI_ENV_VALUE,
    });
    expect(marked).not.toBe(env);
    expect(env.LAIA_ARCH_CLI).toBe("0");
  });
});

describe("ensureLaiaArchExecMarkerOnProcess", () => {
  it("mutates and returns the provided process env", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

    expect(ensureLaiaArchExecMarkerOnProcess(env)).toBe(env);
    expect(env[LAIA_ARCH_CLI_ENV_VAR]).toBe(LAIA_ARCH_CLI_ENV_VALUE);
  });

  it("defaults to mutating process.env when no env object is provided", () => {
    const previous = process.env[LAIA_ARCH_CLI_ENV_VAR];
    delete process.env[LAIA_ARCH_CLI_ENV_VAR];

    try {
      expect(ensureLaiaArchExecMarkerOnProcess()).toBe(process.env);
      expect(process.env[LAIA_ARCH_CLI_ENV_VAR]).toBe(LAIA_ARCH_CLI_ENV_VALUE);
    } finally {
      if (previous === undefined) {
        delete process.env[LAIA_ARCH_CLI_ENV_VAR];
      } else {
        process.env[LAIA_ARCH_CLI_ENV_VAR] = previous;
      }
    }
  });
});
