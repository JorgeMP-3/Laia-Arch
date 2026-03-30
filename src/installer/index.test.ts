import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./plan-generator.js", () => ({
  displayPlan: vi.fn(),
  buildWireGuardServerSetupCommands: vi.fn(() => []),
  generatePlan: vi.fn(async () => ({
    steps: [],
    estimatedMinutes: 1,
    warnings: [],
    requiredCredentials: ["laia-arch-admin-password"],
  })),
}));

import { buildConversationIntent } from "./agentic.js";
import { parseInstallerConfirmationInput, prepareInstallerExecutionArtifacts } from "./index.js";
import { generatePlan } from "./plan-generator.js";
import type { InstallerConfig, SystemScan } from "./types.js";

function createConfig(overrides?: Partial<InstallerConfig>): InstallerConfig {
  return {
    company: {
      name: "Laia Agency",
      sector: "Marketing",
      teamSize: 8,
      language: "es",
      timezone: "Europe/Madrid",
    },
    access: {
      totalUsers: 8,
      roles: [
        { name: "creativos", count: 3 },
        { name: "cuentas", count: 3 },
        { name: "comerciales", count: 2 },
      ],
      remoteUsers: 2,
      devices: ["mac", "ios"],
      needsVpn: true,
      needsMfa: false,
    },
    services: {
      dns: true,
      ldap: true,
      samba: true,
      wireguard: true,
      docker: true,
      nginx: true,
      cockpit: true,
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
      dataTypes: ["campaigns", "clients"],
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
    ...overrides,
  };
}

function createScan(): SystemScan {
  return {
    os: { distribution: "Ubuntu", version: "24.04", kernel: "6.8", hostname: "arch-01" },
    hardware: { arch: "x86_64", cores: 8, ramGb: 16, diskFreeGb: 200, diskTotalGb: 512 },
    network: {
      localIp: "192.168.100.14",
      subnet: "255.255.255.0",
      gateway: "192.168.100.1",
      dns: "1.1.1.1",
      hasInternet: true,
      devices: [],
    },
    services: ["ssh"],
    ports: [22],
    software: { python3: "3.12" },
    warnings: [],
  };
}

describe("installer execution artifact selection", () => {
  beforeEach(() => {
    vi.mocked(generatePlan).mockClear();
  });

  it("uses direct agentic proposals in adaptive mode without calling plan-generator", async () => {
    const config = createConfig({ installMode: "adaptive" });
    const scan = createScan();
    const intent = buildConversationIntent(config, "adaptive", [], scan);

    const artifacts = await prepareInstallerExecutionArtifacts({ config, intent, scan });

    expect(artifacts.strategy).toBe("agentic-direct");
    expect(artifacts.proposals?.length).toBeGreaterThan(0);
    expect(vi.mocked(generatePlan)).not.toHaveBeenCalled();
  });

  it("keeps the deterministic generator for guided mode", async () => {
    const config = createConfig({ installMode: "guided" });
    const scan = createScan();
    const intent = buildConversationIntent(config, "guided", [], scan);

    const artifacts = await prepareInstallerExecutionArtifacts({ config, intent, scan });

    expect(artifacts.strategy).toBe("deterministic-plan");
    expect(artifacts.usesPlanGenerator).toBe(true);
    expect(vi.mocked(generatePlan)).toHaveBeenCalledTimes(1);
  });

  it("falls back to the deterministic generator when adaptive intent is missing", async () => {
    const config = createConfig({ installMode: "adaptive" });

    const artifacts = await prepareInstallerExecutionArtifacts({ config });

    expect(artifacts.strategy).toBe("deterministic-plan");
    expect(artifacts.usesPlanGenerator).toBe(true);
    expect(vi.mocked(generatePlan)).toHaveBeenCalledTimes(1);
  });
});

describe("installer confirmation input parsing", () => {
  it("accepts yes variants", () => {
    expect(parseInstallerConfirmationInput("s")).toBe(true);
    expect(parseInstallerConfirmationInput("Sí")).toBe(true);
    expect(parseInstallerConfirmationInput(" yes ")).toBe(true);
  });

  it("accepts no variants", () => {
    expect(parseInstallerConfirmationInput("n")).toBe(false);
    expect(parseInstallerConfirmationInput(" no ")).toBe(false);
  });

  it("rejects invalid keys instead of silently treating them as no", () => {
    expect(parseInstallerConfirmationInput("x")).toBeUndefined();
    expect(parseInstallerConfirmationInput("")).toBeUndefined();
    expect(parseInstallerConfirmationInput("1")).toBeUndefined();
  });
});
