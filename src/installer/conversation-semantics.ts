// conversation-semantics.ts — Análisis semántico de la conversación
//
// Mientras conversation.ts gestiona el intercambio con la IA (turnos, tokens,
// prompts), este archivo analiza el CONTENIDO de esa conversación para extraer:
//
//  • Hechos confirmados (ConversationFact)    — lo que se sabe con certeza
//  • Huecos pendientes (ConversationGap)      — lo que falta o es ambiguo
//  • Contradicciones (ConversationContradiction) — lo que el usuario contradijo
//  • Decisiones (string[])                   — frases de decisión legibles
//  • Resumen (string)                        — una línea con el estado de la sesión
//
// La función principal de este archivo es buildConversationArtifacts():
// combina heurísticas locales (inferConfirmedConversationFacts, etc.) con los
// artefactos opcionales que la IA ya devolvió, produciendo el conjunto final
// de calidad maxima por fusión con mergeConversationFacts/Gaps/Contradictions.
//
// No llama a ninguna IA ni ejecuta comandos; es análisis puro sobre datos.

import type {
  AccessModel,
  CompanyProfile,
  ConversationContradiction,
  ConversationFact,
  ConversationGap,
  ConversationIntent,
  DataCompliance,
  InstallMode,
  NetworkConfig,
  SecurityPolicy,
  ServiceSelection,
  SystemScan,
  UserConfig,
} from "./types.js";

export interface ConversationDataLike {
  company: CompanyProfile;
  access: AccessModel;
  services: ServiceSelection;
  security: SecurityPolicy;
  compliance: DataCompliance;
  network: NetworkConfig;
  users: UserConfig[];
}

export interface ConversationMessageLike {
  role: "user" | "assistant";
  content: string;
}

const DEFAULT_COMPANY_SECTOR = "Organización";
const DEFAULT_ROLE_NAME = "usuarios";
const REMOTE_SIGNAL =
  "(?:remot(?:o|os|a|as)?|teletrab(?:ajo|aja|ajan|ajando)?|desde casa|fuera de la oficina|fuera del despacho)";

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "laia";
}

function isGenericCompanyName(value: string, scan: SystemScan): boolean {
  return !value.trim() || value.trim() === scan.os.hostname.trim();
}

function isGenericRoles(data: ConversationDataLike): boolean {
  return (
    data.access.roles.length === 0 ||
    (data.access.roles.length === 1 &&
      data.access.roles[0]?.name === DEFAULT_ROLE_NAME &&
      data.users.length === 0)
  );
}

function uniqueByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

// Ordinal numérico del nivel de confianza para comparar hechos.
// Se usa en mergeConversationFacts para quedarse siempre con el de mayor certeza.
function confidenceRank(confidence: ConversationFact["confidence"]): number {
  if (confidence === "confirmed") {
    return 3;
  }
  if (confidence === "inferred") {
    return 2;
  }
  return 1;
}

// Fusiona varios grupos de hechos (IA + heurísticos) eliminando duplicados.
// Si dos hechos tienen la misma clave+valor, se queda el de mayor confianza.
export function mergeConversationFacts(...groups: ConversationFact[][]): ConversationFact[] {
  const bestByKey = new Map<string, ConversationFact>();

  for (const fact of groups.flat()) {
    const key = `${fact.key}::${JSON.stringify(fact.value)}`;
    const existing = bestByKey.get(key);
    if (!existing || confidenceRank(fact.confidence) > confidenceRank(existing.confidence)) {
      bestByKey.set(key, fact);
    }
  }

  return [...bestByKey.values()];
}

// Fusiona huecos de múltiples fuentes. Si hay duplicados por key, se queda con
// el más estricto (blocking=true gana) y la descripción más larga.
export function mergeConversationGaps(...groups: ConversationGap[][]): ConversationGap[] {
  const merged = new Map<string, ConversationGap>();

  for (const gap of groups.flat()) {
    const existing = merged.get(gap.key);
    if (!existing) {
      merged.set(gap.key, gap);
      continue;
    }
    merged.set(gap.key, {
      ...existing,
      blocking: existing.blocking || gap.blocking,
      description:
        existing.description.length >= gap.description.length
          ? existing.description
          : gap.description,
      suggestedDefault: existing.suggestedDefault ?? gap.suggestedDefault,
    });
  }

  return [...merged.values()];
}

export function mergeConversationContradictions(
  ...groups: ConversationContradiction[][]
): ConversationContradiction[] {
  return uniqueByKey(groups.flat(), (item) =>
    [item.key, item.firstStatement, item.laterStatement, item.resolution ?? ""].join("::"),
  );
}

// Infiere hechos confirmados directamente de la estructura de datos (sin IA).
// Omite valores genéricos (nombre = hostname, sector = "Organización")
// porque no aportan información real. Solo incluye lo que se sabe de verdad.
export function inferConfirmedConversationFacts(
  data: ConversationDataLike,
  scan: SystemScan,
): ConversationFact[] {
  const services = Object.entries(data.services)
    .filter(([, enabled]) => enabled)
    .map(([service]) => service)
    .toSorted();

  const facts: ConversationFact[] = [];

  if (!isGenericCompanyName(data.company.name, scan)) {
    facts.push({
      key: "company.name",
      value: data.company.name,
      confidence: "confirmed",
      source: "Configuracion estructurada final de la conversacion.",
    });
  }

  if (data.company.sector !== DEFAULT_COMPANY_SECTOR) {
    facts.push({
      key: "company.sector",
      value: data.company.sector,
      confidence: "confirmed",
      source: "Configuracion estructurada final de la conversacion.",
    });
  }

  facts.push(
    {
      key: "company.teamSize",
      value: data.company.teamSize,
      confidence: "inferred",
      source: "Perfil estructurado del instalador.",
    },
    {
      key: "access.remoteUsers",
      value: data.access.remoteUsers,
      confidence: "inferred",
      source: "Modelo de acceso estructurado del instalador.",
    },
    {
      key: "services.selected",
      value: services,
      confidence: "inferred",
      source: "Servicios estructurados del instalador.",
    },
    {
      key: "network.internalDomain",
      value: data.network.internalDomain,
      confidence: "inferred",
      source: "Configuracion de red estructurada del instalador.",
    },
    {
      key: "compliance.backupRetentionDays",
      value: data.compliance.backupRetentionDays,
      confidence: "inferred",
      source: "Politica de retencion estructurada del instalador.",
    },
  );

  if (!isGenericRoles(data)) {
    facts.push({
      key: "access.roles",
      value: data.access.roles.map((role) => ({ name: role.name, count: role.count })),
      confidence: "inferred",
      source: "Roles estructurados del instalador.",
    });
  }

  if (data.users.length > 0) {
    facts.push({
      key: "users.named",
      value: data.users.map((user) => user.username),
      confidence: "inferred",
      source: "Usuarios estructurados del instalador.",
    });
  }

  return facts;
}

// Detecta huecos bloqueantes comparando la config contra invariantes del sistema:
//  - nombre genérico o igual al hostname → bloqueante
//  - sector por defecto                  → bloqueante
//  - sin roles definidos                 → bloqueante
//  - dominio sin .local                  → bloqueante
//  - docker desactivado (Agora lo requiere) → bloqueante
//  - usuarios remotos sin WireGuard      → bloqueante
export function inferPendingConversationGaps(
  data: ConversationDataLike,
  scan: SystemScan,
): ConversationGap[] {
  const gaps: ConversationGap[] = [];

  if (isGenericCompanyName(data.company.name, scan)) {
    gaps.push({
      key: "company.name",
      description: "Falta confirmar el nombre real de la organizacion.",
      blocking: true,
    });
  }

  if (data.company.sector === DEFAULT_COMPANY_SECTOR) {
    gaps.push({
      key: "company.sector",
      description: "Falta confirmar a que se dedica la organizacion.",
      blocking: true,
    });
  }

  if (isGenericRoles(data)) {
    gaps.push({
      key: "access.roles",
      description: "Falta definir los roles o departamentos reales del equipo.",
      blocking: true,
    });
  }

  if (!data.network.internalDomain.endsWith(".local")) {
    gaps.push({
      key: "network.internalDomain",
      description: "El dominio interno debe cerrarse como dominio .local.",
      blocking: true,
      suggestedDefault: `${slugify(data.company.name || scan.os.hostname)}.local`,
    });
  }

  if (!data.services.docker) {
    gaps.push({
      key: "services.docker",
      description: "Docker debe quedar activo porque Laia Agora base depende de el.",
      blocking: true,
      suggestedDefault: true,
    });
  }

  if (data.access.remoteUsers > 0 && !data.services.wireguard) {
    gaps.push({
      key: "services.wireguard",
      description: "Hay personas remotas y falta confirmar la VPN WireGuard.",
      blocking: true,
      suggestedDefault: true,
    });
  }

  if (data.users.length === 0) {
    gaps.push({
      key: "users.named",
      description: "Aun no hay usuarios nominales; se podran crear despues si hace falta.",
      blocking: false,
    });
  }

  return gaps;
}

// Analiza los mensajes del usuario buscando señales de acceso remoto
// usando expresiones regulares. Detecta tanto afirmaciones ("hay personas remotas")
// como negaciones ("no hay nadie remoto") para luego cruzarlas y detectar
// contradicciones en inferConversationContradictions.
function detectRemoteSignal(messages: ConversationMessageLike[]): {
  positive?: { statement: string; index: number };
  negative?: { statement: string; index: number };
} {
  const positivePatterns = [
    new RegExp(
      `\\b(?:si|sí|tenemos|hay|trabajan|trabaja|son)\\b[\\s\\S]{0,40}\\b${REMOTE_SIGNAL}\\b`,
      "i",
    ),
    new RegExp(
      `\\b\\d+\\b[\\s\\S]{0,20}\\b(?:personas|usuarios|empleados|comerciales)\\b[\\s\\S]{0,20}\\b${REMOTE_SIGNAL}\\b`,
      "i",
    ),
    new RegExp(`\\b${REMOTE_SIGNAL}\\b`, "i"),
  ];
  const negativePatterns = [
    new RegExp(`\\b(?:no|ningun[oa]?|ningún|nadie)\\b[\\s\\S]{0,25}\\b${REMOTE_SIGNAL}\\b`, "i"),
    new RegExp(`\\bno\\s+hay\\b[\\s\\S]{0,30}\\b${REMOTE_SIGNAL}\\b`, "i"),
  ];

  let positive: { statement: string; index: number } | undefined;
  let negative: { statement: string; index: number } | undefined;

  for (const [index, message] of messages.entries()) {
    if (message.role !== "user") {
      continue;
    }
    if (!positive && positivePatterns.some((pattern) => pattern.test(message.content))) {
      positive = { statement: message.content, index };
    }
    if (!negative && negativePatterns.some((pattern) => pattern.test(message.content))) {
      negative = { statement: message.content, index };
    }
  }

  return { positive, negative };
}

function detectTeamSizeStatements(messages: ConversationMessageLike[]): Array<{
  value: number;
  statement: string;
}> {
  const statements: Array<{ value: number; statement: string }> = [];

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const match = message.content.match(
      /\b(\d+)\b\s*(?:personas|usuarios|empleados|miembros|trabajadores)\b/i,
    );
    if (!match) {
      continue;
    }

    statements.push({
      value: Number(match[1]),
      statement: message.content,
    });
  }

  return statements;
}

// Detecta contradicciones en el transcript: señales remotas opuestas y
// tamaños de equipo inconsistentes. El resultado se incluye en ConversationIntent
// para que el executor pueda decidir si pausar o asumir el valor más reciente.
export function inferConversationContradictions(
  messages: ConversationMessageLike[],
): ConversationContradiction[] {
  const contradictions: ConversationContradiction[] = [];
  const remoteSignals = detectRemoteSignal(messages);

  if (remoteSignals.positive && remoteSignals.negative) {
    const first =
      remoteSignals.positive.index < remoteSignals.negative.index
        ? remoteSignals.positive.statement
        : remoteSignals.negative.statement;
    const later =
      remoteSignals.positive.index < remoteSignals.negative.index
        ? remoteSignals.negative.statement
        : remoteSignals.positive.statement;
    contradictions.push({
      key: "access.remoteUsers",
      firstStatement: first,
      laterStatement: later,
      resolution: "",
    });
  }

  const teamSizeStatements = detectTeamSizeStatements(messages);
  const uniqueTeamSizes = [...new Set(teamSizeStatements.map((item) => item.value))];
  if (uniqueTeamSizes.length > 1) {
    const first = teamSizeStatements[0];
    const later = [...teamSizeStatements].toReversed().find((item) => item.value !== first?.value);
    if (first && later) {
      contradictions.push({
        key: "company.teamSize",
        firstStatement: first.statement,
        laterStatement: later.statement,
        resolution: "",
      });
    }
  }

  return contradictions;
}

function formatRoles(data: ConversationDataLike): string {
  if (data.access.roles.length === 0) {
    return "por definir";
  }
  return data.access.roles.map((role) => `${role.name} (${role.count})`).join(", ");
}

function formatServices(data: ConversationDataLike): string {
  const services = Object.entries(data.services)
    .filter(([, enabled]) => enabled)
    .map(([service]) => service)
    .toSorted();
  return services.join(", ") || "ninguno";
}

export function buildConversationDecisions(input: {
  data: ConversationDataLike;
  mode: InstallMode;
  contradictions: ConversationContradiction[];
  gaps: ConversationGap[];
}): string[] {
  const { data, mode, contradictions, gaps } = input;
  const blockingGaps = gaps.filter((gap) => gap.blocking);
  const unresolvedContradictions = contradictions.filter(
    (contradiction) => !contradiction.resolution?.trim(),
  );

  const decisions = [
    `Modo de instalacion: ${mode}.`,
    `Dominio interno previsto: ${data.network.internalDomain}.`,
    `Servicios principales: ${formatServices(data)}.`,
    `Resultado objetivo: host base configurado con Laia Agora validada en el puerto 18789.`,
    `Retencion de backups: ${data.compliance.backupRetentionDays} dias.`,
    data.access.remoteUsers > 0 || data.services.wireguard
      ? "Habra acceso remoto mediante WireGuard."
      : "El acceso quedara limitado a red local y VPN futura si se activa despues.",
  ];

  if (blockingGaps.length > 0) {
    decisions.push(
      `Quedan datos bloqueantes por cerrar: ${blockingGaps.map((gap) => gap.key).join(", ")}.`,
    );
  }

  if (unresolvedContradictions.length > 0) {
    decisions.push(
      `Hay contradicciones pendientes de resolver: ${unresolvedContradictions
        .map((item) => item.key)
        .join(", ")}.`,
    );
  }

  return decisions;
}

export function buildConversationSummary(input: {
  data: ConversationDataLike;
  mode: InstallMode;
  contradictions: ConversationContradiction[];
  gaps: ConversationGap[];
}): string {
  const { data, mode, contradictions, gaps } = input;
  const blockingGaps = gaps.filter((gap) => gap.blocking);
  const unresolvedContradictions = contradictions.filter(
    (contradiction) => !contradiction.resolution?.trim(),
  );

  const statusParts: string[] = [];
  if (blockingGaps.length > 0) {
    statusParts.push(`faltan ${blockingGaps.length} dato(s) bloqueante(s)`);
  }
  if (unresolvedContradictions.length > 0) {
    statusParts.push(`${unresolvedContradictions.length} contradiccion(es) sin cerrar`);
  }
  if (statusParts.length === 0) {
    statusParts.push("lista para plan de ejecucion");
  }

  return [
    `Empresa: ${data.company.name}`,
    `Modo: ${mode}`,
    `Equipo: ${data.company.teamSize}`,
    `Roles: ${formatRoles(data)}`,
    `Servicios: ${formatServices(data)}`,
    `Agora: base prevista en 18789`,
    `Estado: ${statusParts.join(" y ")}`,
  ].join(" | ");
}

// Función orquestadora: produce todos los artefactos semánticos de la conversación.
// Combina heurísticas locales con artefactos opcionales que la IA pudo haber
// devuelto directamente (aiFacts, aiGaps, aiContradictions). El resultado es
// lo que se guarda en ConversationIntent antes de pasar a la Fase 3 (plan).
export function buildConversationArtifacts(input: {
  messages: ConversationMessageLike[];
  data: ConversationDataLike;
  scan: SystemScan;
  mode: InstallMode;
  aiFacts?: ConversationFact[];
  aiGaps?: ConversationGap[];
  aiContradictions?: ConversationContradiction[];
}): {
  confirmedFacts: ConversationFact[];
  pendingGaps: ConversationGap[];
  contradictions: ConversationContradiction[];
  decisions: string[];
  summary: string;
} {
  const heuristicFacts = inferConfirmedConversationFacts(input.data, input.scan);
  const heuristicGaps = inferPendingConversationGaps(input.data, input.scan);
  const heuristicContradictions = inferConversationContradictions(input.messages);

  const confirmedFacts = mergeConversationFacts(input.aiFacts ?? [], heuristicFacts);
  const pendingGaps = mergeConversationGaps(input.aiGaps ?? [], heuristicGaps);
  const contradictions = mergeConversationContradictions(
    input.aiContradictions ?? [],
    heuristicContradictions,
  );

  return {
    confirmedFacts,
    pendingGaps,
    contradictions,
    decisions: buildConversationDecisions({
      data: input.data,
      mode: input.mode,
      contradictions,
      gaps: pendingGaps,
    }),
    summary: buildConversationSummary({
      data: input.data,
      mode: input.mode,
      contradictions,
      gaps: pendingGaps,
    }),
  };
}

// Genera el mensaje de confirmación que se muestra al usuario al cerrar la
// conversación, resumiendo huecos bloqueantes y contradicciones pendientes.
export function buildArchAgoraOutcomeMessage(intent: ConversationIntent): string {
  const blockingGaps = intent.pendingGaps.filter((gap) => gap.blocking);
  const unresolvedContradictions = intent.contradictions.filter(
    (contradiction) => !contradiction.resolution?.trim(),
  );
  const lines = [
    "Resumen operativo guardado:",
    `- Laia Arch ya tiene una intencion reutilizable para ${intent.goal.companyName}.`,
    `- El objetivo final queda fijado como host base + Laia Agora validada en ${intent.goal.targetDomain} y puerto 18789.`,
    `- Servicios previstos: ${intent.goal.desiredServices.join(", ") || "ninguno"}.`,
  ];

  if (blockingGaps.length > 0) {
    lines.push(
      `- Antes del plan final conviene revisar estos bloqueos: ${blockingGaps
        .map((gap) => gap.key)
        .join(", ")}.`,
    );
  } else {
    lines.push("- No se detectan huecos bloqueantes en la conversacion.");
  }

  if (unresolvedContradictions.length > 0) {
    lines.push(
      `- Hay contradicciones pendientes que deberian revisarse: ${unresolvedContradictions
        .map((item) => item.key)
        .join(", ")}.`,
    );
  }

  return lines.join("\n");
}
