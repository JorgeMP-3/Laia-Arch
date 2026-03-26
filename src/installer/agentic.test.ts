import { describe, expect, it } from "vitest";
import {
  buildActionProposalsFromPlan,
  buildConversationIntent,
  createInstallSessionState,
} from "./agentic.js";
import { generatePlan } from "./plan-generator.js";
import type { InstallerConfig } from "./types.js";

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

describe("agentic installer helpers", () => {
  // ── buildConversationIntent ─────────────────────────────────────────────

  it("builds a reusable conversation intent from installer config", () => {
    const config = createConfig();
    const intent = buildConversationIntent(config, "adaptive", [
      "user: Somos una agencia con dos comerciales remotos.",
      "assistant: Activaré WireGuard y Docker.",
    ]);

    expect(intent.goal.companyName).toBe("Laia Agency");
    expect(intent.goal.desiredServices).toContain("docker");
    expect(intent.confirmedFacts.some((fact) => fact.key === "company.name")).toBe(true);
    expect(intent.decisions.some((decision) => decision.includes("Docker"))).toBe(true);
    expect(intent.conversationMessages).toHaveLength(2);
  });

  it("detects WireGuard contradiction when remoteUsers > 0 but wireguard disabled", () => {
    const config = createConfig({
      services: {
        dns: true,
        ldap: true,
        samba: false,
        wireguard: false, // contradicción: hay remotos pero WireGuard off
        docker: true,
        nginx: false,
        cockpit: false,
        backups: true,
      },
    });
    const intent = buildConversationIntent(config, "adaptive", []);

    const contradiction = intent.contradictions.find((c) => c.key === "services.wireguard");
    expect(contradiction).toBeDefined();
    expect(contradiction?.resolution).toBeTruthy();
  });

  it("detects pending gap when network domain is missing", () => {
    const config = createConfig({ network: undefined });
    const intent = buildConversationIntent(config, "adaptive", []);

    const gap = intent.pendingGaps.find((g) => g.key === "network.internalDomain");
    expect(gap).toBeDefined();
    expect(gap?.blocking).toBe(true);
  });

  it("detects pending gap when no named users are defined", () => {
    const config = createConfig({ users: [] });
    const intent = buildConversationIntent(config, "guided", []);

    const gap = intent.pendingGaps.find((g) => g.key === "users.named");
    expect(gap).toBeDefined();
    expect(gap?.blocking).toBe(false);
  });

  it("adds scan-derived facts when scan is provided", () => {
    const config = createConfig();
    const mockScan = {
      os: { distribution: "Ubuntu", version: "22.04", kernel: "6.2", hostname: "srv01" },
      hardware: { arch: "x86_64", cores: 4, ramGb: 8, diskFreeGb: 50, diskTotalGb: 100 },
      network: {
        localIp: "192.168.100.14",
        subnet: "255.255.255.0",
        gateway: "192.168.100.1",
        dns: "1.1.1.1",
        hasInternet: true,
        devices: [],
      },
      services: [],
      ports: [],
      software: {},
      warnings: [],
    };
    const intent = buildConversationIntent(config, "adaptive", [], mockScan);

    expect(intent.goal.targetHostname).toBe("srv01");
    const osFact = intent.confirmedFacts.find((f) => f.key === "scan.os");
    expect(osFact).toBeDefined();
    expect(osFact?.source).toBe("scan");
    const ipFact = intent.confirmedFacts.find((f) => f.key === "scan.localIp");
    expect(ipFact?.value).toBe("192.168.100.14");
  });

  it("marks remoteAccessRequired = true when remoteUsers > 0", () => {
    const intent = buildConversationIntent(createConfig(), "adaptive", []);
    expect(intent.goal.remoteAccessRequired).toBe(true);
  });

  it("marks remoteAccessRequired = false when no remote users", () => {
    const config = createConfig({
      access: {
        totalUsers: 5,
        roles: [{ name: "admin", count: 5 }],
        remoteUsers: 0,
        devices: ["linux"],
        needsVpn: false,
        needsMfa: false,
      },
      services: {
        dns: true,
        ldap: true,
        samba: false,
        wireguard: false,
        docker: true,
        nginx: false,
        cockpit: false,
        backups: true,
      },
    });
    const intent = buildConversationIntent(config, "tool-driven", []);
    expect(intent.goal.remoteAccessRequired).toBe(false);
  });

  // ── buildActionProposalsFromPlan ────────────────────────────────────────

  it("derives fallback proposals and keeps Agora verification requirements", async () => {
    const plan = await generatePlan(createConfig());
    const proposals = buildActionProposalsFromPlan(plan);
    const agoraProposal = proposals.find((proposal) => proposal.sourceStepId === "agora-03");

    expect(agoraProposal).toBeTruthy();
    expect(
      agoraProposal?.verification.some((requirement) => requirement.kind === "gateway-health"),
    ).toBe(true);
    expect(agoraProposal?.servicesTouched).toContain("docker");
  });

  it("only requires gateway health after the final Agora startup step", async () => {
    const plan = await generatePlan(createConfig());
    const proposals = buildActionProposalsFromPlan(plan);
    const agoraPrepare = proposals.find((proposal) => proposal.sourceStepId === "agora-01");
    const agoraCompose = proposals.find((proposal) => proposal.sourceStepId === "agora-02");
    const agoraStart = proposals.find((proposal) => proposal.sourceStepId === "agora-03");

    expect(agoraPrepare?.verification).toEqual([]);
    expect(agoraCompose?.verification).toEqual([]);
    expect(
      agoraStart?.verification.some((requirement) => requirement.kind === "gateway-health"),
    ).toBe(true);
  });

  it("assigns correct phase to each proposal", async () => {
    const plan = await generatePlan(createConfig());
    const proposals = buildActionProposalsFromPlan(plan);

    // Todos los pasos Agora son fase 6
    const agoraProposals = proposals.filter((p) => p.sourceStepId?.startsWith("agora-"));
    expect(agoraProposals.length).toBeGreaterThan(0);
    for (const p of agoraProposals) {
      expect(p.phase).toBe(6);
    }
  });

  it("adds dns verification requirements to dns-* proposals", async () => {
    const plan = await generatePlan(createConfig());
    const proposals = buildActionProposalsFromPlan(plan);
    const dnsProposals = proposals.filter((p) => p.sourceStepId?.startsWith("dns-"));

    expect(dnsProposals.length).toBeGreaterThan(0);
    for (const p of dnsProposals) {
      expect(p.verification.some((r) => r.kind === "service-active" && r.service === "bind9")).toBe(
        true,
      );
    }
  });

  it("adds ldap verification requirements to ldap-* proposals", async () => {
    const plan = await generatePlan(createConfig());
    const proposals = buildActionProposalsFromPlan(plan);
    const ldapProposals = proposals.filter((p) => p.sourceStepId?.startsWith("ldap-"));

    expect(ldapProposals.length).toBeGreaterThan(0);
    for (const p of ldapProposals) {
      expect(p.verification.some((r) => r.kind === "service-active" && r.service === "slapd")).toBe(
        true,
      );
    }
  });

  it("proposal ids are unique across the plan", async () => {
    const plan = await generatePlan(createConfig());
    const proposals = buildActionProposalsFromPlan(plan);
    const ids = proposals.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  // ── createInstallSessionState ───────────────────────────────────────────

  it("creates a session state with config, goal and fallback plan", async () => {
    const config = createConfig();
    const intent = buildConversationIntent(config, "adaptive", []);
    const plan = await generatePlan(config);
    const proposals = buildActionProposalsFromPlan(plan);
    const session = createInstallSessionState({
      planSignature: "test-signature",
      config,
      goal: intent.goal,
      fallbackPlan: plan,
      intent,
      proposals,
      snapshot: {
        timestamp: new Date().toISOString(),
        planSignature: "test-signature",
        observedServices: {},
        warnings: [],
      },
    });

    expect(session.goal.companyName).toBe("Laia Agency");
    expect(session.fallbackPlan.steps.length).toBeGreaterThan(0);
    expect(session.proposals.length).toBe(plan.steps.length);
    expect(session.completedProposalIds).toEqual([]);
  });

  it("session starts with empty executions, repairs and approvals", async () => {
    const config = createConfig();
    const intent = buildConversationIntent(config, "adaptive", []);
    const plan = await generatePlan(config);
    const session = createInstallSessionState({
      planSignature: "sig-empty",
      config,
      goal: intent.goal,
      fallbackPlan: plan,
      snapshot: { timestamp: new Date().toISOString(), observedServices: {}, warnings: [] },
    });

    expect(Object.keys(session.executions)).toHaveLength(0);
    expect(Object.keys(session.repairs)).toHaveLength(0);
    expect(Object.keys(session.approvals)).toHaveLength(0);
    expect(session.currentProposalId).toBeUndefined();
    expect(session.version).toBe(1);
  });

  it("session tracks completed proposals separately from executions", async () => {
    const config = createConfig();
    const intent = buildConversationIntent(config, "adaptive", []);
    const plan = await generatePlan(config);
    const session = createInstallSessionState({
      planSignature: "sig-resume",
      config,
      goal: intent.goal,
      fallbackPlan: plan,
      snapshot: { timestamp: new Date().toISOString(), observedServices: {}, warnings: [] },
    });

    // Simular que un proposal quedó completado (como haría el executor al reanudar)
    session.completedProposalIds.push("proposal-1-dns-01");
    expect(session.completedProposalIds).toContain("proposal-1-dns-01");
    // Las ejecuciones siguen vacías — el tracking es independiente
    expect(Object.keys(session.executions)).toHaveLength(0);
  });
});
