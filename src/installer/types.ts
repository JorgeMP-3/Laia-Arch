// types.ts — Tipos compartidos del instalador de Laia Arch
//
// Este archivo define TODOS los tipos del sistema. Está dividido en 7 bloques:
//
//  1. ESCANEO DEL SISTEMA   — lo que el scanner observa del hardware/OS/red
//  2. PERFIL DE EMPRESA     — lo que el usuario declara sobre su organización
//  3. SEMÁNTICA DE LA CONVERSACIÓN — hechos, huecos y contradicciones extraídos por la IA
//  4. PLAN DE INSTALACIÓN   — pasos ordenados que se van a ejecutar
//  5. EJECUCIÓN AGÉNTICA    — propuestas, verificaciones, reparaciones y estado de sesión
//  6. CONFIGURACIÓN IA      — proveedor AI y modo de instalación
//  7. CONTRATOS DE HERRAMIENTAS — el sobre estándar que devuelven todas las tools

// ── 1. ESCANEO DEL SISTEMA ────────────────────────────────────────────────────

export interface NetworkDevice {
  ip: string;
  mac?: string;
  vendor?: string;
}

export interface SystemScan {
  hardware: {
    arch: string;
    cores: number;
    ramGb: number;
    diskFreeGb: number;
    diskTotalGb: number;
  };
  os: {
    distribution: string;
    version: string;
    kernel: string;
    hostname: string;
  };
  network: {
    localIp: string;
    subnet: string;
    gateway: string;
    dns: string;
    hasInternet: boolean;
    devices: NetworkDevice[];
  };
  services: string[];
  ports: number[];
  software: {
    node?: string;
    docker?: string;
    python3?: string;
    git?: string;
  };
  warnings: string[];
}

// ── 2. PERFIL DE EMPRESA ─────────────────────────────────────────────────────
// InstallerConfig es el objeto central que agrupa todo lo declarado por el usuario.
// Lo produce la conversación y lo consume el plan-generator para emitir los pasos.

export interface CompanyProfile {
  name: string;
  sector: string;
  teamSize: number;
  language: string;
  timezone: string;
}

export interface Role {
  name: string;
  count: number;
}

export interface AccessModel {
  totalUsers: number;
  roles: Role[];
  remoteUsers: number;
  devices: string[];
  needsVpn: boolean;
  needsMfa: boolean;
}

export interface ServiceSelection {
  dns: boolean;
  ldap: boolean;
  samba: boolean;
  wireguard: boolean;
  docker: boolean;
  nginx: boolean;
  cockpit: boolean;
  backups: boolean;
}

export interface SecurityPolicy {
  passwordComplexity: "basic" | "medium" | "high";
  diskEncryption: boolean;
  internetExposed: boolean;
  sshKeyOnly: boolean;
}

export interface DataCompliance {
  gdpr: boolean;
  backupRetentionDays: number;
  dataTypes: string[];
  jurisdiction: string;
}

export interface NetworkConfig {
  serverIp: string;
  subnet: string;
  gateway: string;
  internalDomain: string;
  vpnRange: string;
  dhcpRange: string;
}

export interface UserConfig {
  username: string;
  role: string;
  remote: boolean;
}

// Los tres modos de instalación:
//  "tool-driven" → la IA usa herramientas directamente, mínima interacción
//  "guided"      → 7 preguntas fijas, camino predecible
//  "adaptive"    → la IA adapta la conversación a la empresa (camino personalizado)
export type InstallMode = "tool-driven" | "guided" | "adaptive";

export interface InstallerConfig {
  company: CompanyProfile;
  access: AccessModel;
  services: ServiceSelection;
  security: SecurityPolicy;
  compliance: DataCompliance;
  network?: NetworkConfig;
  users?: UserConfig[];
  installMode?: InstallMode;
}

export interface InstallationGoal {
  companyName: string;
  installMode: InstallMode;
  targetHostname: string;
  targetDomain: string;
  desiredServices: string[];
  remoteAccessRequired: boolean;
  desiredUsers: UserConfig[];
}

// ── 3. SEMÁNTICA DE LA CONVERSACIÓN ──────────────────────────────────────────
// La IA no solo recoge datos; también clasifica lo que sabe, lo que falta
// (gaps) y lo que el usuario contradijo. Esto alimenta el ConversationIntent.

// Nivel de certeza de un hecho:
//  "confirmed" → el usuario lo dijo explícitamente
//  "inferred"  → se dedujo de contexto (ej. "tenemos comerciales" → remote=true)
//  "uncertain" → se asumió por defecto, no hay evidencia clara
export type ConfidenceLevel = "confirmed" | "inferred" | "uncertain";

export interface ConversationFact {
  key: string;
  value: unknown;
  confidence: ConfidenceLevel;
  source: string;
}

export interface ConversationGap {
  key: string;
  description: string;
  blocking: boolean;
  suggestedDefault?: unknown;
}

export interface ConversationContradiction {
  key: string;
  firstStatement: string;
  laterStatement: string;
  resolution?: string;
}

export interface ConversationIntent {
  mode: InstallMode;
  goal: InstallationGoal;
  summary: string;
  confirmedFacts: ConversationFact[];
  pendingGaps: ConversationGap[];
  contradictions: ConversationContradiction[];
  decisions: string[];
  installerConfig: InstallerConfig;
  conversationMessages: Array<{ role: "user" | "assistant"; content: string }>;
  completedAt: string;
}

// ConversationIntent es el "artefacto" que sale de la conversación.
// Encapsula tanto la config estructurada (installerConfig) como la
// semántica: hechos confirmados, huecos pendientes, decisiones tomadas
// y el transcript completo. El executor lo usa para contexto de reparación.
export interface ConversationResult {
  config: InstallerConfig;
  intent: ConversationIntent;
}

// ── 4. PLAN DE INSTALACIÓN ────────────────────────────────────────────────────
// InstallPlan contiene los InstallStep generados por plan-generator.ts.
// Cada step tiene un id (ej. "dns-01"), fase, comandos y rollback.
// Los ActionProposal son la versión enriquecida de los steps que usa el executor:
// añaden verificación esperada, archivos tocados y servicios afectados.

// Tipos de verificación que el executor puede lanzar para validar un step:
//  "service-active"     → systemctl is-active <service>
//  "dns-resolution"     → dig/host al dominio interno
//  "ldap-bind"          → ldapsearch base
//  "samba-share"        → smbclient -L
//  "wireguard-active"   → wg show
//  "docker-operational" → docker info
//  "nginx-config"       → nginx -t
//  "backup-test"        → ejecución del script rsync
//  "gateway-health"     → HTTP GET /healthz al gateway de Agora
export interface VerificationRequirement {
  kind:
    | "service-active"
    | "dns-resolution"
    | "ldap-bind"
    | "samba-share"
    | "wireguard-active"
    | "docker-operational"
    | "nginx-config"
    | "backup-test"
    | "gateway-health";
  service?: string;
  hostname?: string;
  share?: string;
  url?: string;
  description: string;
}

export interface InstallStep {
  id: string;
  phase: number;
  description: string;
  commands: string[];
  requiresApproval: boolean;
  rollback?: string;
  /** Timeout por comando en ms. Por defecto 600 000 (10 min). */
  timeout?: number;
  /** Reintentos máximos ante errores transitorios. Por defecto 2. */
  maxRetries?: number;
}

export interface ActionProposal {
  id: string;
  title: string;
  description: string;
  sourceStepId?: string;
  phase: number;
  commands: string[];
  requiresApproval: boolean;
  rollback?: string;
  timeout?: number;
  maxRetries?: number;
  verification: VerificationRequirement[];
  changedFiles: string[];
  servicesTouched: string[];
}

export interface InstallPlan {
  steps: InstallStep[];
  estimatedMinutes: number;
  warnings: string[];
  requiredCredentials: string[];
}

export interface InstallationSnapshot {
  timestamp: string;
  planSignature?: string;
  scan?: SystemScan;
  observedServices: Record<string, "active" | "inactive" | "not-installed" | "unknown">;
  serviceChain?: Record<string, unknown>;
  gateway?: {
    url: string;
    reachable: boolean;
    healthzOk: boolean;
  };
  warnings: string[];
}

export interface VerificationCheckResult {
  requirement: VerificationRequirement;
  success: boolean;
  details?: string;
}

export interface VerificationReport {
  proposalId: string;
  success: boolean;
  retryable: boolean;
  summary: string;
  checks: VerificationCheckResult[];
  observedState?: Record<string, unknown>;
}

// ── 5. EJECUCIÓN AGÉNTICA ─────────────────────────────────────────────────────
// El executor mantiene un InstallSessionState que persiste todo lo que pasa:
//  - proposals: lista de ActionProposal (derivados del plan)
//  - approvals:  decisiones del usuario (aprobado/rechazado)
//  - executions: historial de intentos de ejecución por propuesta
//  - repairs:    historial de estrategias de reparación aplicadas
//  - completedProposalIds: propuestas finalizadas con éxito
//
// Política de reparación:
//  1. Reintento transitorio (2x) → si el error parece temporal (timeout, red...)
//  2. Reintento de verificación  → la ejecución pasó pero la verificación falló
//  3. Rescate por IA             → la IA diagnostica y propone comandos alternativos
//  4. Escalada manual            → HITL: el usuario decide cómo continuar

export interface ActionExecution {
  proposalId: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  startedAt: string;
  finishedAt?: string;
  attempt: number;
  output?: string;
  error?: string;
  verification?: VerificationReport;
}

export interface RepairAttempt {
  proposalId: string;
  attempt: number;
  strategy: "transient-retry" | "verification-retry" | "ai-rescue" | "manual-escalation";
  status: "pending" | "succeeded" | "failed" | "cancelled";
  notes: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface InstallSessionState {
  version: number;
  planSignature: string;
  goal: InstallationGoal;
  config: InstallerConfig;
  intent?: ConversationIntent;
  fallbackPlan: InstallPlan;
  proposals: ActionProposal[];
  snapshot: InstallationSnapshot;
  approvals: Record<
    string,
    {
      status: ApprovalResult | "rescue";
      timestamp: string;
    }
  >;
  executions: Record<string, ActionExecution[]>;
  repairs: Record<string, RepairAttempt[]>;
  completedProposalIds: string[];
  currentProposalId?: string;
  updatedAt: string;
}

// ── 6. CONFIGURACIÓN IA ───────────────────────────────────────────────────────
// BootstrapResult viene de bootstrap.ts: identifica el proveedor (Anthropic,
// OpenAI, DeepSeek, Ollama...), el modelo y si soporta reasoning extendido.
// ModeConfig mapea el InstallMode a parámetros concretos de llamada a la API.

export interface ModeConfig {
  mode: InstallMode;
  systemPrompt: string;
  useTools: boolean;
  contextLevel: "minimal" | "full" | "none";
  maxTokensPerCall: number;
}

export type ApprovalResult = "approved" | "rejected" | "timeout";

export interface ApprovalRequest {
  id: string;
  step: InstallStep;
  timestamp: Date;
  timeoutSeconds: number;
}

export type AuthMethod = "api-key" | "setup-token" | "oauth";

export interface AiProvider {
  id: "anthropic" | "deepseek" | "openai" | "ollama" | "openai-compatible" | "openrouter";
  name: string;
  models: string[];
  baseUrl?: string;
  authMethods?: string[];
}

export interface BootstrapResult {
  providerId: string;
  model: string;
  /** ID del perfil en auth-profiles.json (e.g. "anthropic:default") */
  profileId: string;
  authMethod: AuthMethod;
  /** Tipo de credencial almacenada — indica cómo leer el valor al recuperarla */
  authType: "api_key" | "token" | "oauth";
  baseUrl?: string;
  /** true si el modelo soporta reasoning extendido (chain-of-thought, extended thinking).
   *  Lo rellena bootstrap.ts; conversation.ts lo usa para ajustar parámetros de la llamada. */
  supportsReasoning?: boolean;
}

// ── 7. CONTRATOS DE HERRAMIENTAS ──────────────────────────────────────────────
// Todas las tools (system-tools, service-tools, verify-tools) devuelven
// un ToolResultEnvelope estándar. Esto permite al executor leer el resultado
// de forma uniforme sin importar qué tool ejecutó el paso.

export interface ToolResultEnvelope {
  success: boolean;
  retryable: boolean;
  observed_state: Record<string, unknown>;
  changed_files: string[];
  services_touched: string[];
  rollback_hint?: string;
  error?: string;
  output?: unknown;
}
