// agentic.ts — Capa de transformación entre config/plan y estructuras agénticas
//
// Este archivo NO ejecuta nada ni llama a la IA. Su función es construir los
// objetos semánticos que el executor necesita para operar:
//
//  buildConversationIntent()      → crea el ConversationIntent a partir de una
//                                   InstallerConfig (útil cuando se usa preset
//                                   y se salta la Fase 2 de conversación)
//
//  buildActionProposalsFromPlan() → convierte los InstallStep del plan en
//                                   ActionProposal enriquecidos (con verificación
//                                   esperada, archivos tocados y servicios afectados)
//
//  createInstallSessionState()    → inicializa el InstallSessionState vacío que
//                                   el executor irá rellenando durante la ejecución

import type {
  ActionProposal,
  ConversationContradiction,
  ConversationFact,
  ConversationGap,
  ConversationIntent,
  InstallMode,
  InstallPlan,
  InstallSessionState,
  InstallerConfig,
  ServiceSelection,
  SystemScan,
} from "./types.js";

// Devuelve la lista de servicios habilitados en la config (solo los que son true).
function listDesiredServices(services: ServiceSelection): Array<keyof ServiceSelection> {
  return Object.entries(services)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name as keyof ServiceSelection);
}

// Construye hechos confirmados a partir de la InstallerConfig estructurada.
// No analiza lenguaje natural; solo traduce campos de config a ConversationFact.
function buildConversationFacts(config: InstallerConfig, scan?: SystemScan): ConversationFact[] {
  const facts: ConversationFact[] = [
    {
      key: "company.name",
      value: config.company.name,
      confidence: "confirmed",
      source: "user",
    },
    {
      key: "company.sector",
      value: config.company.sector,
      confidence: "confirmed",
      source: "user",
    },
    {
      key: "access.roles",
      value: config.access.roles.map((role) => `${role.name}:${role.count}`).join(", "),
      confidence: "confirmed",
      source: "user",
    },
    {
      key: "access.remoteUsers",
      value: String(config.access.remoteUsers),
      confidence: "confirmed",
      source: "user",
    },
    {
      key: "services.enabled",
      value: listDesiredServices(config.services).join(", "),
      confidence: "inferred",
      source: "inferred",
    },
    {
      key: "network.internalDomain",
      value: config.network?.internalDomain ?? "(unset)",
      confidence: config.network ? "confirmed" : "uncertain",
      source: config.network ? "user" : "default",
    },
  ];

  if (scan) {
    facts.push(
      {
        key: "scan.os",
        value: `${scan.os.distribution} ${scan.os.version}`,
        confidence: "confirmed",
        source: "scan",
      },
      {
        key: "scan.localIp",
        value: scan.network.localIp,
        confidence: "confirmed",
        source: "scan",
      },
    );
  }

  return facts;
}

// Genera frases de decisión legibles (para logs y contexto de reparación).
// Explican por qué ciertos servicios están activos/desactivados.
function buildConversationDecisions(config: InstallerConfig): string[] {
  const decisions = [
    `Install mode: ${config.installMode ?? "adaptive"}.`,
    config.access.remoteUsers > 0
      ? "WireGuard should remain enabled because remote users were requested."
      : "WireGuard can stay disabled if remote access is not needed.",
    config.services.docker
      ? "Docker remains enabled to support Agora base deployment."
      : "Docker was disabled explicitly in the current configuration.",
  ];

  if (config.security.sshKeyOnly) {
    decisions.push("SSH access is restricted to keys only.");
  }

  return decisions;
}

export function buildConversationIntent(
  config: InstallerConfig,
  mode: InstallMode,
  transcript: string[],
  scan?: SystemScan,
): ConversationIntent {
  const desiredServices = listDesiredServices(config.services);
  const summary = [
    `${config.company.name} (${config.company.sector})`,
    `${config.access.totalUsers} users`,
    desiredServices.join(", ") || "no services selected",
    config.access.remoteUsers > 0
      ? `${config.access.remoteUsers} remote users`
      : "local-only access",
  ].join(" | ");

  const pendingGaps: ConversationGap[] = [];
  if (!config.users || config.users.length === 0) {
    pendingGaps.push({
      key: "users.named",
      description: "Named LDAP users are still undefined.",
      blocking: false,
      suggestedDefault: [],
    });
  }
  if (!config.network?.internalDomain) {
    pendingGaps.push({
      key: "network.internalDomain",
      description: "The internal domain has not been confirmed.",
      blocking: true,
    });
  }

  const contradictions: ConversationContradiction[] = [];
  if (config.access.remoteUsers > 0 && !config.services.wireguard) {
    contradictions.push({
      key: "services.wireguard",
      firstStatement: "Remote users were requested.",
      laterStatement: "WireGuard is disabled in the selected services.",
      resolution: "Enable WireGuard before execution or accept a local-only deployment.",
    });
  }

  return {
    mode,
    summary,
    goal: {
      companyName: config.company.name,
      installMode: mode,
      targetHostname: scan?.os.hostname ?? config.company.name.toLowerCase(),
      targetDomain: config.network?.internalDomain ?? `${config.company.name.toLowerCase()}.local`,
      desiredServices,
      remoteAccessRequired: config.access.remoteUsers > 0,
      desiredUsers: config.users ?? [],
    },
    confirmedFacts: buildConversationFacts(config, scan),
    pendingGaps,
    contradictions,
    decisions: buildConversationDecisions(config),
    installerConfig: config,
    conversationMessages: transcript.map((line) => {
      const separator = line.indexOf(": ");
      const role = line.slice(0, separator) === "assistant" ? "assistant" : "user";
      return {
        role,
        content: separator >= 0 ? line.slice(separator + 2) : line,
      };
    }),
    completedAt: new Date().toISOString(),
  };
}

// Infiere qué servicio systemd toca un step basándose en su prefijo de id.
// Ej: "ldap-02" → ["slapd"], "agora-03" → ["docker"]
function deriveServicesTouched(stepId: string): string[] {
  if (stepId.startsWith("dns-")) {
    return ["bind9"];
  }
  if (stepId.startsWith("ldap-")) {
    return ["slapd"];
  }
  if (stepId.startsWith("samba-")) {
    return ["smbd", "nmbd"];
  }
  if (stepId.startsWith("wireguard-")) {
    return ["wg-quick@wg0"];
  }
  if (stepId.startsWith("docker-")) {
    return ["docker"];
  }
  if (stepId.startsWith("nginx-")) {
    return ["nginx"];
  }
  if (stepId.startsWith("cockpit-")) {
    return ["cockpit.socket"];
  }
  if (stepId.startsWith("backup-")) {
    return ["cron"];
  }
  if (stepId.startsWith("agora-")) {
    return ["docker"];
  }
  return [];
}

// Extrae rutas de archivo que aparecen en los comandos del step.
// Solo captura rutas bajo prefijos de sistema relevantes (/etc/, /srv/, /opt/, etc.)
// para que el executor sepa qué archivos potencialmente cambió el paso.
function deriveChangedFiles(stepCommands: string[]): string[] {
  const interestingPrefixes = ["/etc/", "/srv/", "/opt/", "/var/backups/", "/usr/local/bin/"];
  const changed = new Set<string>();
  for (const command of stepCommands) {
    for (const match of command.matchAll(/\/[A-Za-z0-9._/-]+/g)) {
      const candidate = match[0];
      if (interestingPrefixes.some((prefix) => candidate.startsWith(prefix))) {
        changed.add(candidate);
      }
    }
  }
  return [...changed];
}

// Devuelve los VerificationRequirement que el executor debe comprobar
// después de ejecutar un step. La lógica es determinista por prefijo de id:
//  dns-*     → service-active(bind9) + dns-resolution
//  ldap-*    → service-active(slapd) + ldap-bind
//  samba-*   → service-active(smbd) + samba-share
//  wireguard → wireguard-active
//  docker-*  → docker-operational
//  nginx-*   → nginx-config + service-active(nginx)
//  backup-*  → backup-test
//  agora-03  → gateway-health (HTTP /healthz)
function deriveExpectedVerification(stepId: string, config?: InstallerConfig) {
  if (stepId.startsWith("dns-")) {
    return [
      { kind: "service-active" as const, service: "bind9", description: "DNS service is active." },
      {
        kind: "dns-resolution" as const,
        hostname: config?.network?.internalDomain ?? "localhost",
        description: "The local DNS resolver responds.",
      },
    ];
  }
  if (stepId.startsWith("ldap-")) {
    return [
      { kind: "service-active" as const, service: "slapd", description: "LDAP service is active." },
      { kind: "ldap-bind" as const, description: "LDAP responds to a base search." },
    ];
  }
  if (stepId.startsWith("samba-")) {
    return [
      { kind: "service-active" as const, service: "smbd", description: "Samba service is active." },
      { kind: "samba-share" as const, description: "At least one Samba share is visible." },
    ];
  }
  if (stepId.startsWith("wireguard-")) {
    return [
      {
        kind: "wireguard-active" as const,
        service: "wg-quick@wg0",
        description: "WireGuard interface is active.",
      },
    ];
  }
  if (stepId.startsWith("docker-")) {
    return [
      {
        kind: "docker-operational" as const,
        service: "docker",
        description: "Docker daemon is operational.",
      },
    ];
  }
  if (stepId.startsWith("nginx-")) {
    return [
      { kind: "nginx-config" as const, description: "Nginx configuration validates cleanly." },
      { kind: "service-active" as const, service: "nginx", description: "Nginx is active." },
    ];
  }
  if (stepId.startsWith("backup-")) {
    return [{ kind: "backup-test" as const, description: "Backup script runs successfully." }];
  }
  if (stepId === "agora-03") {
    return [
      {
        kind: "gateway-health" as const,
        url: "http://127.0.0.1:18789/healthz",
        description: "Agora gateway health endpoint responds.",
      },
    ];
  }
  return [];
}

export function buildActionProposalsFromPlan(
  plan: InstallPlan,
  config?: InstallerConfig,
): ActionProposal[] {
  return plan.steps.map((step, index) => ({
    id: `proposal-${index + 1}-${step.id}`,
    title: step.description,
    description: step.description,
    sourceStepId: step.id,
    phase: step.phase,
    commands: step.commands,
    requiresApproval: step.requiresApproval,
    rollback: step.rollback,
    timeout: step.timeout,
    maxRetries: step.maxRetries,
    verification: deriveExpectedVerification(step.id, config),
    changedFiles: deriveChangedFiles(step.commands),
    servicesTouched: deriveServicesTouched(step.id),
  }));
}

export function createInstallSessionState(params: {
  planSignature: string;
  config: InstallerConfig;
  goal: ConversationIntent["goal"];
  fallbackPlan: InstallPlan;
  intent?: ConversationIntent;
  proposals?: ActionProposal[];
  snapshot: InstallSessionState["snapshot"];
}): InstallSessionState {
  const now = new Date().toISOString();
  return {
    version: 1,
    planSignature: params.planSignature,
    goal: params.goal,
    config: params.config,
    fallbackPlan: params.fallbackPlan,
    updatedAt: now,
    intent: params.intent,
    snapshot: params.snapshot,
    proposals: params.proposals ?? [],
    approvals: {},
    executions: {},
    repairs: {},
    completedProposalIds: [],
  };
}
