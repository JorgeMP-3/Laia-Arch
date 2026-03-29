import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRescueOperationalMemory,
  captureInstallSecrets,
  parseFailedStepResolution,
  parseResumeDecision,
  restoreInstallSecrets,
  verifySingleRequirement,
} from "./executor.js";
import type {
  BootstrapResult,
  ConversationIntent,
  InstallPlan,
  InstallSessionState,
  VerificationRequirement,
} from "./types.js";

function createRescueTestSession(): InstallSessionState {
  const intent: ConversationIntent = {
    mode: "adaptive",
    goal: {
      companyName: "Laia Agency",
      installMode: "adaptive",
      targetHostname: "laia-host",
      targetDomain: "laia.local",
      desiredServices: ["dns", "ldap", "docker"],
      remoteAccessRequired: true,
      desiredUsers: [{ username: "ana.garcia", role: "creativos", remote: true }],
    },
    summary: "Empresa: Laia Agency | Servicios: dns, ldap, docker",
    confirmedFacts: [],
    pendingGaps: [
      {
        key: "users.named",
        description: "Faltan algunos usuarios por definir.",
        blocking: false,
      },
    ],
    contradictions: [],
    decisions: ["Docker debe quedar activo para Agora base."],
    installerConfig: {
      company: {
        name: "Laia Agency",
        sector: "Marketing",
        teamSize: 8,
        language: "es",
        timezone: "Europe/Madrid",
      },
      access: {
        totalUsers: 8,
        roles: [{ name: "creativos", count: 4 }],
        remoteUsers: 1,
        devices: ["mac"],
        needsVpn: true,
        needsMfa: false,
      },
      services: {
        dns: true,
        ldap: true,
        samba: false,
        wireguard: true,
        docker: true,
        nginx: false,
        cockpit: false,
        backups: true,
      },
      security: {
        passwordComplexity: "high",
        diskEncryption: false,
        internetExposed: false,
        sshKeyOnly: true,
      },
      compliance: {
        gdpr: true,
        backupRetentionDays: 30,
        dataTypes: ["clients"],
        jurisdiction: "ES",
      },
      network: {
        serverIp: "192.168.100.14",
        subnet: "192.168.100.0/24",
        gateway: "192.168.100.1",
        internalDomain: "laia.local",
        vpnRange: "10.10.10.0/24",
        dhcpRange: "192.168.100.100-200",
      },
      users: [{ username: "ana.garcia", role: "creativos", remote: true }],
      installMode: "adaptive",
    },
    conversationMessages: [],
    completedAt: new Date().toISOString(),
  };

  return {
    version: 1,
    planSignature: "test-plan",
    goal: intent.goal,
    config: intent.installerConfig,
    intent,
    fallbackPlan: {
      steps: [],
      estimatedMinutes: 10,
      warnings: [],
      requiredCredentials: [],
    },
    proposals: [
      {
        id: "proposal-1-dns-01",
        title: "Instalar BIND9",
        description: "Instalar BIND9",
        sourceStepId: "dns-01",
        phase: 2,
        commands: ["apt-get install -y bind9"],
        requiresApproval: true,
        verification: [],
        changedFiles: ["/etc/bind/named.conf.local"],
        servicesTouched: ["bind9"],
      },
      {
        id: "proposal-2-ldap-01",
        title: "Instalar LDAP",
        description: "Instalar LDAP",
        sourceStepId: "ldap-01",
        phase: 3,
        commands: ["apt-get install -y slapd"],
        requiresApproval: true,
        verification: [],
        changedFiles: ["/etc/ldap"],
        servicesTouched: ["slapd"],
      },
    ],
    snapshot: {
      timestamp: new Date().toISOString(),
      observedServices: {},
      warnings: [],
    },
    approvals: {},
    executions: {
      "proposal-1-dns-01": [
        {
          proposalId: "proposal-1-dns-01",
          status: "done",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          attempt: 1,
          output: "bind9 installed\nnamed started",
          verification: {
            proposalId: "proposal-1-dns-01",
            success: true,
            retryable: false,
            summary: "All verification checks passed.",
            checks: [
              {
                requirement: {
                  kind: "service-active",
                  service: "bind9",
                  description: "DNS service is active.",
                },
                success: true,
                details: "service bind9: active",
              },
            ],
          },
        },
      ],
      "proposal-2-ldap-01": [
        {
          proposalId: "proposal-2-ldap-01",
          status: "failed",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          attempt: 1,
          output: "dpkg error\nslapd not configured",
          error: "ldap install failed",
          verification: {
            proposalId: "proposal-2-ldap-01",
            success: false,
            retryable: true,
            summary: "LDAP bind failed.",
            checks: [
              {
                requirement: {
                  kind: "ldap-bind",
                  description: "LDAP responds to a base search.",
                },
                success: false,
                details: "ldap active=false responds=false",
              },
            ],
          },
        },
      ],
    },
    repairs: {
      "proposal-2-ldap-01": [
        {
          proposalId: "proposal-2-ldap-01",
          attempt: 1,
          strategy: "verification-retry",
          status: "failed",
          notes: "Restart touched services: slapd",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: "slapd could not restart",
        },
      ],
    },
    completedProposalIds: ["proposal-1-dns-01"],
    updatedAt: new Date().toISOString(),
  };
}

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

describe("installer executor failed-step decisions", () => {
  it("parses retry, rescue, and skip answers", () => {
    expect(parseFailedStepResolution("reintentar", true)).toBe("retry");
    expect(parseFailedStepResolution("r", true)).toBe("retry");
    expect(parseFailedStepResolution("rescate", true)).toBe("rescue");
    expect(parseFailedStepResolution("volver al rescate", true)).toBe("rescue");
    expect(parseFailedStepResolution("saltar", true)).toBe("skip");
    expect(parseFailedStepResolution("s", true)).toBe("skip");
  });

  it("rejects rescue answers when rescue is not available", () => {
    expect(parseFailedStepResolution("rescate", false)).toBeUndefined();
    expect(parseFailedStepResolution("desconocido", true)).toBeUndefined();
  });
});

describe("installer executor verification requirements", () => {
  it("verifies path-exists requirements against the filesystem", () => {
    const tempPath = path.join(os.tmpdir(), `laia-path-exists-${process.pid}.txt`);
    fs.writeFileSync(tempPath, "ok");

    const result = verifySingleRequirement({
      kind: "path-exists",
      path: tempPath,
      description: "Temporary file exists.",
    } satisfies VerificationRequirement);

    expect(result.success).toBe(true);
    expect(result.details).toContain("exists");

    fs.unlinkSync(tempPath);
  });

  it("verifies hostname-configured requirements against the current hostname", () => {
    const result = verifySingleRequirement({
      kind: "hostname-configured",
      hostname: os.hostname().trim().toLowerCase(),
      description: "Hostname matches current system hostname.",
    } satisfies VerificationRequirement);

    expect(result.success).toBe(true);
    expect(result.details).toContain("hostname=");
  });
});

describe("installer rescue operational memory", () => {
  it("includes original intent, execution history and repair history from the same session", () => {
    const memory = buildRescueOperationalMemory(createRescueTestSession());

    expect(memory.intentContext).toContain("Resumen original: Empresa: Laia Agency");
    expect(memory.intentContext).toContain("Servicios deseados: dns, ldap, docker");
    expect(memory.executionHistory).toContain("[dns-01] Instalar BIND9");
    expect(memory.executionHistory).toContain("verificación=OK");
    expect(memory.executionHistory).toContain("[ldap-01] Instalar LDAP");
    expect(memory.executionHistory).toContain("verificación=FAIL");
    expect(memory.repairHistory).toContain("estrategia=verification-retry");
    expect(memory.repairHistory).toContain("slapd could not restart");
  });
});
