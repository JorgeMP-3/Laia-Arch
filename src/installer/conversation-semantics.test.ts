import { describe, expect, it } from "vitest";
import {
  buildArchAgoraOutcomeMessage,
  buildConversationArtifacts,
  type ConversationMessageLike,
  inferConversationContradictions,
  inferPendingConversationGaps,
} from "./conversation-semantics.js";
import type { ConversationIntent, InstallMode, SystemScan } from "./types.js";

function createScan(): SystemScan {
  return {
    hardware: {
      arch: "arm64",
      cores: 8,
      ramGb: 16,
      diskFreeGb: 200,
      diskTotalGb: 512,
    },
    os: {
      distribution: "Ubuntu",
      version: "24.04",
      kernel: "6.8.0",
      hostname: "laia-host",
    },
    network: {
      localIp: "192.168.100.14",
      subnet: "192.168.100.0/24",
      gateway: "192.168.100.1",
      dns: "192.168.100.14",
      hasInternet: true,
      devices: [],
    },
    services: [],
    ports: [],
    software: {
      node: "22.0.0",
      docker: "27.0.0",
    },
    warnings: [],
  };
}

function createData() {
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
      passwordComplexity: "high" as const,
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
  };
}

describe("conversation semantics", () => {
  it("detects contradictions for remote access and team size", () => {
    const messages: ConversationMessageLike[] = [
      { role: "user", content: "No hay nadie en remoto ahora mismo." },
      { role: "assistant", content: "Entendido." },
      { role: "user", content: "En realidad tenemos 2 comerciales remotos." },
      { role: "assistant", content: "Anotado." },
      { role: "user", content: "El sistema lo usaran 8 personas." },
      { role: "assistant", content: "Perfecto." },
      { role: "user", content: "Perdon, al final seran 10 personas." },
    ];

    const contradictions = inferConversationContradictions(messages);

    expect(contradictions.some((item) => item.key === "access.remoteUsers")).toBe(true);
    expect(contradictions.some((item) => item.key === "company.teamSize")).toBe(true);
  });

  it("flags blocking gaps when conversation still has default placeholders", () => {
    const scan = createScan();
    const data = createData();
    data.company.name = scan.os.hostname;
    data.company.sector = "Organización";
    data.access.roles = [{ name: "usuarios", count: 8 }];
    data.users = [];
    data.services.wireguard = false;

    const gaps = inferPendingConversationGaps(data, scan);

    expect(gaps.some((gap) => gap.key === "company.name" && gap.blocking)).toBe(true);
    expect(gaps.some((gap) => gap.key === "company.sector" && gap.blocking)).toBe(true);
    expect(gaps.some((gap) => gap.key === "access.roles" && gap.blocking)).toBe(true);
    expect(gaps.some((gap) => gap.key === "services.wireguard" && gap.blocking)).toBe(true);
    expect(gaps.some((gap) => gap.key === "users.named" && !gap.blocking)).toBe(true);
  });

  it("builds artifacts that keep Agora in the summary and preserve AI facts", () => {
    const scan = createScan();
    const data = createData();
    const messages: ConversationMessageLike[] = [
      { role: "user", content: "Somos Laia Agency, una agencia de marketing de 8 personas." },
      { role: "assistant", content: "Entendido." },
      { role: "user", content: "Hay 2 comerciales remotos y queremos Docker, LDAP y Samba." },
    ];

    const artifacts = buildConversationArtifacts({
      messages,
      data,
      scan,
      mode: "adaptive" satisfies InstallMode,
      aiFacts: [
        {
          key: "company.name",
          value: "Laia Agency",
          confidence: "confirmed",
          source: "Declarado por el administrador.",
        },
      ],
      aiGaps: [],
      aiContradictions: [],
    });

    expect(artifacts.summary).toContain("Agora: base prevista en 18789");
    expect(artifacts.decisions.some((decision) => decision.includes("Laia Agora"))).toBe(true);
    expect(artifacts.confirmedFacts.some((fact) => fact.key === "company.name")).toBe(true);
    expect(artifacts.pendingGaps.some((gap) => gap.blocking)).toBe(false);
  });

  it("builds an operator-facing summary mentioning blockers and Agora target", () => {
    const intent: ConversationIntent = {
      mode: "adaptive",
      goal: {
        companyName: "Laia Agency",
        installMode: "adaptive",
        targetHostname: "laia-host",
        targetDomain: "laia.local",
        desiredServices: ["dns", "ldap", "docker", "backups"],
        remoteAccessRequired: false,
        desiredUsers: [],
      },
      summary: "Empresa: Laia Agency",
      confirmedFacts: [],
      pendingGaps: [
        {
          key: "access.roles",
          description: "Falta definir roles.",
          blocking: true,
        },
      ],
      contradictions: [
        {
          key: "company.teamSize",
          firstStatement: "Somos 8 personas.",
          laterStatement: "Seremos 10 personas.",
          resolution: "",
        },
      ],
      decisions: [],
      installerConfig: {
        ...createData(),
        installMode: "adaptive",
      },
      conversationMessages: [],
      completedAt: new Date().toISOString(),
    };

    const message = buildArchAgoraOutcomeMessage(intent);

    expect(message).toContain("Laia Agora");
    expect(message).toContain("18789");
    expect(message).toContain("access.roles");
    expect(message).toContain("company.teamSize");
  });
});
