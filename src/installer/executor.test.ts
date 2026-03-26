import { describe, expect, it } from "vitest";
import { captureInstallSecrets, parseResumeDecision, restoreInstallSecrets } from "./executor.js";
import type { BootstrapResult, InstallPlan } from "./types.js";

describe("installer executor resume decisions", () => {
  it("supports resuming, restarting, and clean restarts", () => {
    expect(parseResumeDecision("s")).toBe("resume");
    expect(parseResumeDecision("sí")).toBe("resume");
    expect(parseResumeDecision("n")).toBe("restart");
    expect(parseResumeDecision("d")).toBe("clean-restart");
    expect(parseResumeDecision("desinstalar")).toBe("clean-restart");
  });

  it("preserves generated install credentials and the bootstrap auth profile for clean restarts", async () => {
    const writes: Array<{ id: string; value: string }> = [];
    const profileWrites: Array<{ profileId: string; provider: string }> = [];
    const plan: InstallPlan = {
      steps: [],
      estimatedMinutes: 0,
      warnings: [],
      requiredCredentials: ["laia-arch-ldap-admin-password", "laia-arch-admin-password"],
    };
    const bootstrap: BootstrapResult = {
      providerId: "anthropic",
      model: "claude-haiku-4-5",
      profileId: "anthropic:default",
      authMethod: "api-key",
      authType: "api_key",
    };

    const snapshot = await captureInstallSecrets(plan, bootstrap, {
      readGeneratedCredential: async (id) => `${id}-value`,
      writeGeneratedCredential: async (id, value) => {
        writes.push({ id, value });
      },
      readBootstrapProfile: (profileId) => ({
        type: "api_key",
        provider: "anthropic",
        key: `${profileId}-key`,
      }),
      writeBootstrapProfile: (profileId, credential) => {
        profileWrites.push({ profileId, provider: credential.provider });
      },
    });

    expect(snapshot.generatedCredentials).toEqual([
      { id: "laia-arch-ldap-admin-password", value: "laia-arch-ldap-admin-password-value" },
      { id: "laia-arch-admin-password", value: "laia-arch-admin-password-value" },
    ]);
    expect(snapshot.bootstrapProfile?.profileId).toBe("anthropic:default");

    await restoreInstallSecrets(snapshot, {
      readGeneratedCredential: async () => "",
      writeGeneratedCredential: async (id, value) => {
        writes.push({ id, value });
      },
      readBootstrapProfile: () => ({
        type: "api_key",
        provider: "anthropic",
        key: "",
      }),
      writeBootstrapProfile: (profileId, credential) => {
        profileWrites.push({ profileId, provider: credential.provider });
      },
    });

    expect(writes).toEqual([
      { id: "laia-arch-ldap-admin-password", value: "laia-arch-ldap-admin-password-value" },
      { id: "laia-arch-admin-password", value: "laia-arch-admin-password-value" },
    ]);
    expect(profileWrites).toEqual([{ profileId: "anthropic:default", provider: "anthropic" }]);
  });
});
