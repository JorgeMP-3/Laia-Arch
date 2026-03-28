// conversation.ts — Fase 2: Conversación con la IA para recopilar la configuración
// La IA guía al administrador a través de 6 etapas. Nunca ve contraseñas.

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import {
  buildArchAgoraOutcomeMessage,
  buildConversationArtifacts,
} from "./conversation-semantics.js";
import type { ProvisionalGateway } from "./provisional-gateway.js";
import { INSTALLER_USERNAME_EXAMPLE } from "./tools/username-policy.js";
import type {
  AccessModel,
  BootstrapResult,
  CompanyProfile,
  ConversationContradiction,
  ConversationFact,
  ConversationGap,
  ConversationIntent,
  ConversationResult,
  DataCompliance,
  InstallationGoal,
  InstallMode,
  InstallerConfig,
  ModeConfig,
  NetworkConfig,
  SecurityPolicy,
  ServiceSelection,
  SystemScan,
  UserConfig,
} from "./types.js";

// Los prompts están en install-prompts/ en la raíz del repo.
// process.cwd() siempre apunta a la raíz del proyecto donde se ejecuta laia-arch.
const PROMPTS_DIR = path.resolve(process.cwd(), "install-prompts");
const PROMPTS_SESSION_ROOT = path.join(os.homedir(), ".laia-arch", "installer-prompts");

export type ConversationState = "idle" | "active" | "complete";

// ── Tipos internos ────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
}

// ── Detección de capacidades del modelo ───────────────────────────────────

/** Devuelve true si el modelo soporta reasoning extendido o pensamiento en cadena. */
function isReasoningModel(model: string): boolean {
  const reasoningModels = new Set([
    "deepseek-reasoner",
    "claude-opus-4-5",
    "o1",
    "o1-mini",
    "o3",
    "o3-mini",
  ]);
  if (reasoningModels.has(model)) {
    return true;
  }
  const lower = model.toLowerCase();
  return lower.includes("reasoner") || lower.includes("thinking");
}

const REASONING_SUFFIX =
  "\n\nRazona internamente sobre la configuración óptima antes de responder. Sé conciso en las respuestas al usuario.";

// ── Modos de instalación ──────────────────────────────────────────────────

/** Construye el system prompt para el modo Asistido (guided): orden fijo de pasos. */
function buildGuidedPrompt(scan: SystemScan): string {
  return `Eres Laia Arch, el agente fundador del ecosistema LAIA.

ECOSISTEMA LAIA — LO QUE ESTÁS CONSTRUYENDO:
Este servidor alojará tres agentes IA:
- Laia Arch (tú): configura la infraestructura, máximo privilegio,
  solo accesible desde el host físico. Se auto-desactiva al terminar.
- Laia Agora: agente de operaciones diarias, corre en Docker en
  puerto 18789, accesible desde la red local y VPN
- Laia Nemo: interfaz externa, corre en Docker con OpenClaw,
  accesible desde WhatsApp, Telegram, Slack y web pública

SERVIDOR ACTUAL:
${formatScan(scan)}

TU MISIÓN EN ESTE MODO:
Seguir el orden de etapas definido en cada prompt de etapa.
Nunca saltarte una etapa. Nunca cambiar el orden.

PRIORIDAD ABSOLUTA — ENTENDER AL ADMINISTRADOR:
Antes de avanzar a la siguiente etapa debes estar al 100% seguro
de haber entendido lo que el administrador quiere decir.

Si una respuesta es ambigua:
- Repite lo que entendiste con tus propias palabras
- Pregunta "¿Es esto lo que quieres decir?"
- Espera confirmación antes de continuar

Si una respuesta es incompleta:
- Identifica exactamente qué falta
- Pregunta solo por eso, no repitas todo

Si el administrador cambia de tema:
- Recoge la información nueva
- Vuelve a la etapa actual con lo que ya tienes
- "Apunto eso. Volviendo a [etapa actual]: ¿...?"

Si el administrador dice algo contradictorio:
- Señala la contradicción con calma
- "Antes dijiste X, ahora dices Y. ¿Cuál es correcto?"

Si el administrador da más información de la que pediste:
- Recógela toda sin interrumpir
- Confirma que la has entendido antes de avanzar

TONO:
Profesional pero cercano. Claro y directo. Sin tecnicismos
innecesarios. Si usas un término técnico, explícalo en una frase.

NUNCA:
- Asumir el sector de la empresa
- Asumir roles predefinidos
- Avanzar sin confirmación explícita
- Ejecutar nada sin aprobación del plan completo`;
}

/** Construye el system prompt para el modo Adaptativo: sin orden fijo, camino personalizado. */
function buildAdaptivePrompt(scan: SystemScan): string {
  return `Eres Laia Arch, el agente fundador del ecosistema LAIA.

ECOSISTEMA LAIA — LO QUE ESTÁS CONSTRUYENDO:
Este servidor alojará tres agentes IA:
- Laia Arch (tú): configura la infraestructura, máximo privilegio,
  solo accesible desde el host físico. Se auto-desactiva al terminar.
- Laia Agora: agente de operaciones diarias, corre en Docker en
  puerto 18789, accesible desde la red local y VPN
- Laia Nemo: interfaz externa, corre en Docker con OpenClaw,
  accesible desde WhatsApp, Telegram, Slack y web pública

SERVIDOR ACTUAL:
${formatScan(scan)}

TU MISIÓN EN ESTE MODO:
Construir el mapa de instalación óptimo para ESTA organización
específica. No hay orden fijo. El camino lo determina lo que
te diga el administrador.

INFORMACIÓN QUE NECESITAS OBTENER (en cualquier orden):
□ Confirmación del servidor
□ Nombre y tipo de organización
□ Roles, departamentos y número de personas
□ Si hay personas remotas (activa WireGuard automáticamente)
□ Qué servicios necesitan
□ Política de seguridad básica
□ Si manejan datos personales (GDPR)

PRIORIDAD ABSOLUTA — ENTENDER AL ADMINISTRADOR:
Tu objetivo no es hacer preguntas. Es entender qué necesita
esta organización y configurar el servidor de forma óptima.

CONDICIÓN DE CIERRE:
No cierres la conversación si queda una contradicción relevante
sin resolver o si falta algún dato que cambie la instalación.
Si algo puede resolverse con un valor por defecto seguro, dilo
brevemente y sigue.

REGLAS DE ADAPTACIÓN:

Si dan mucha información a la vez:
  Recógela toda. Confirma que la entendiste. Sigue con lo que falta.
  "Entendido: [resumen de lo que dijeron]. Me falta saber: [X]."

Si dan poca información:
  Haz una sola pregunta a la vez. La más importante primero.
  No hagas listas de preguntas. Una pregunta, espera respuesta.

Si dicen algo ambiguo:
  "Cuando dices [X], ¿te refieres a [interpretación A] o [B]?"
  Espera antes de asumir nada.

Si se contradicen:
  "Antes mencionaste [X]. Ahora dices [Y]. ¿Cuál aplicamos?"

ADAPTACIÓN AUTOMÁTICA SEGÚN EL PERFIL:

Organización pequeña (menos de 5 personas):
  - Simplifica: menos grupos LDAP, configuración básica
  - Pregunta si realmente necesitan todos los servicios
  - WireGuard solo si hay remotos confirmados

Organización mediana (5-20 personas):
  - Configuración estándar completa
  - Recomienda todos los servicios base
  - Cockpit recomendado para administración visual

Organización grande (más de 20 personas):
  - Pregunta por subgrupos dentro de roles
  - Recomienda LDAPS (LDAP cifrado)
  - Pregunta si necesitan alta disponibilidad

Sector técnico (IT, desarrollo, ingeniería):
  - Puedes usar términos técnicos sin explicarlos
  - Pregunta si quieren configuración avanzada
  - SSH por clave por defecto sin preguntar

Sector no técnico (legal, salud, educación, administración):
  - Evita tecnicismos completamente
  - Usa analogías: "como una llave en lugar de contraseña"
  - Recomienda contraseñas automáticas sin dudar

SERVICIOS DISPONIBLES Y CUÁNDO RECOMENDARLOS:
- DNS (BIND9): siempre, es la base
- OpenLDAP: siempre, es la base
- Docker: siempre, necesario para desplegar Laia Agora base
- Backups rsync: siempre, esencial
- Samba: si comparten archivos entre equipos
- WireGuard: SOLO si hay remotos — añadir sin preguntar si ya lo confirmaron
- Nginx: si quieren acceder por nombre en lugar de IP
- Cockpit: si quieren gestión visual sin terminal

NUNCA:
- Asumir el sector ni los roles de la organización
- Avanzar sin entender completamente lo que quieren
- Simular acciones — solo ejecutar tools reales
- Generar el plan sin tener toda la información necesaria

RESULTADO QUE DEBES TENER EN MENTE:
La instalación debe dejar preparado el host y el despliegue base
de Laia Agora en Docker con validación en el puerto 18789.`;
}

/**
 * Devuelve la configuración del modo de instalación seleccionado.
 * - tool-driven: preguntas mínimas, ejecuta todo con tools directamente
 * - guided: orden fijo de preguntas, usa tools para ejecutar
 * - adaptive: sin orden fijo, se adapta a cada empresa, usa tools para ejecutar
 */
export function getModeConfig(mode: InstallMode, scan: SystemScan): ModeConfig {
  switch (mode) {
    case "tool-driven":
      return {
        mode,
        systemPrompt: `Eres Laia Arch. Configura este servidor para el
ecosistema LAIA usando las herramientas disponibles.

HAZ EXACTAMENTE ESTAS 5 PREGUNTAS EN ESTE ORDEN:
1. "¿Cuál es el nombre de la organización?"
2. "¿Cuántas personas usarán el sistema?"
3. "¿Qué roles o departamentos tienen? (lista todos)"
4. "¿Hay personas que trabajen en remoto? (sí/no — si sí, cuántas)"
5. "¿Manejan datos personales de clientes? (sí/no)"

Con esas 5 respuestas genera el plan y ejecuta sin más preguntas.

REGLAS ESTRICTAS:
- No hagas ninguna pregunta adicional
- No expliques lo que vas a hacer antes de hacerlo
- Usa las tools directamente para cada paso
- Si algo falla, informa del error exacto y para
- Si una respuesta es ambigua, elige la opción más segura
  y continúa (más servicios mejor que menos)

SERVIDOR: ${formatScan(scan)}`,
        useTools: true,
        contextLevel: "minimal",
        maxTokensPerCall: 1024,
      };

    case "guided":
      return {
        mode,
        systemPrompt: buildGuidedPrompt(scan),
        useTools: true,
        contextLevel: "full",
        maxTokensPerCall: 4096,
      };

    default: // adaptive
      return {
        mode: "adaptive",
        systemPrompt: buildAdaptivePrompt(scan),
        useTools: true,
        contextLevel: "full",
        maxTokensPerCall: 4096,
      };
  }
}

// ── Cliente IA unificado ──────────────────────────────────────────────────

/** Envía un turno al proveedor de IA y devuelve el texto de la respuesta. */
async function callAI(
  gateway: ProvisionalGateway,
  bootstrap: BootstrapResult,
  systemPrompt: string,
  messages: Message[],
  modeConfig?: ModeConfig,
): Promise<string> {
  const useReasoning = bootstrap.supportsReasoning ?? isReasoningModel(bootstrap.model);
  const thinking = useReasoning ? "high" : undefined;

  const response = await gateway.callAgentTurn({
    message:
      modeConfig == null
        ? messages
            .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
            .join("\n\n")
        : (messages.at(-1)?.content ?? "").trim(),
    systemPrompt,
    thinking,
    sessionKey: modeConfig == null ? `installer:extract:${randomUUID()}` : undefined,
  });

  const payloads = response.result?.payloads;
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return "";
  }

  return payloads
    .map((payload) => (typeof payload.text === "string" ? payload.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

// ── Utilidades ────────────────────────────────────────────────────────────

function loadPrompt(name: string, baseDir = PROMPTS_DIR): string {
  const filePath = path.join(baseDir, name);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    console.warn(`  Aviso: no se pudo cargar el prompt ${name}`);
    return "";
  }
}

function createGuidedPromptSessionDir(): string {
  const sessionId = `guided-${new Date().toISOString().replace(/[:.]/g, "-")}-pid${process.pid}`;
  const sessionDir = path.join(PROMPTS_SESSION_ROOT, sessionId);

  fs.mkdirSync(sessionDir, { recursive: true });

  for (const fileName of GUIDED_STAGE_FILES) {
    const sourcePath = path.join(PROMPTS_DIR, fileName);
    const targetPath = path.join(sessionDir, fileName);
    const content = fs.readFileSync(sourcePath, "utf8");
    fs.writeFileSync(targetPath, content, { mode: 0o600 });
  }

  const manifestPath = path.join(sessionDir, "manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        mode: "guided",
        sourceDir: PROMPTS_DIR,
        files: GUIDED_STAGE_FILES,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  return sessionDir;
}

function formatScan(scan: SystemScan): string {
  return [
    "ESTADO ACTUAL DEL SERVIDOR:",
    `  Hardware : ${scan.hardware.arch}, ${scan.hardware.cores} cores, ${scan.hardware.ramGb} GB RAM`,
    `  Disco    : ${scan.hardware.diskFreeGb} GB libres de ${scan.hardware.diskTotalGb} GB`,
    `  Sistema  : ${scan.os.distribution} ${scan.os.version}, kernel ${scan.os.kernel}`,
    `  Hostname : ${scan.os.hostname}`,
    `  Red      : IP ${scan.network.localIp} | Gateway ${scan.network.gateway} | DNS ${scan.network.dns}`,
    `  Internet : ${scan.network.hasInternet ? "disponible" : "SIN CONEXIÓN"}`,
    `  Equipos detectados en red: ${scan.network.devices.length}`,
    scan.ports.length > 0 ? `  Puertos en uso: ${scan.ports.join(", ")}` : "",
    scan.warnings.length > 0 ? `  ⚠ Advertencias: ${scan.warnings.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Muestra el texto de la IA en la terminal con un prefijo visual. */
function printAiMessage(text: string): void {
  console.log();
  const prefix = "  " + t.brand("Laia:") + " ";
  const indent = "         ";
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    process.stdout.write((i === 0 ? prefix : indent) + t.primary(lines[i]) + "\n");
  }
  console.log();
}

// Palabras que indican que el usuario quiere avanzar de etapa
const ADVANCE_WORDS = new Set([
  "continuar",
  "siguiente",
  "adelante",
  "ok",
  "listo",
  "correcto",
  "si",
  "sí",
  "perfecto",
  "aprobado",
  "confirmar",
  "confirmado",
]);

// Palabras que indican que el usuario quiere volver a la etapa anterior
const BACK_WORDS = new Set(["atrás", "atras", "volver", "anterior", "back", "retroceder"]);

// ── Bucle de conversación por etapa ──────────────────────────────────────

type StageOutcome = { action: "advance"; messages: Message[] } | { action: "back" };

/**
 * Ejecuta una etapa conversacional.
 * Devuelve { action: "advance", messages } cuando el usuario avanza,
 * o { action: "back" } cuando pide volver a la etapa anterior.
 * La única forma de salir es Ctrl+C (gestionado por el SIGINT del rl).
 */
async function runStage(
  rl: readline.Interface,
  gateway: ProvisionalGateway,
  bootstrap: BootstrapResult,
  systemPrompt: string,
  initialTrigger: string,
  modeConfig?: ModeConfig,
): Promise<StageOutcome> {
  const messages: Message[] = [{ role: "user", content: initialTrigger }];

  while (true) {
    // Llamar a la IA con el historial actual
    process.stdout.write("  (pensando...)\r");
    const aiText = await callAI(gateway, bootstrap, systemPrompt, messages, modeConfig);
    process.stdout.write("                \r");

    printAiMessage(aiText);
    messages.push({ role: "assistant", content: aiText });

    // La IA puede señalar que la etapa está completa
    const stageComplete =
      aiText.includes("[ETAPA_COMPLETA]") || aiText.includes("[SIGUIENTE_ETAPA]");

    if (stageComplete) {
      return { action: "advance", messages };
    }

    // Leer respuesta del usuario
    const userInput = await new Promise<string>((resolve) => {
      rl.question("  " + t.brandDim("Tú:") + " ", resolve);
    });

    const normalized = userInput.toLowerCase().trim();

    // Volver a la etapa anterior
    if (BACK_WORDS.has(normalized)) {
      return { action: "back" };
    }

    messages.push({ role: "user", content: userInput });

    // Avanzar si el usuario lo indica explícitamente o si la IA marcó la etapa completa
    const userWantsAdvance =
      ADVANCE_WORDS.has(normalized) ||
      [...ADVANCE_WORDS].some(
        (w) => normalized.startsWith(w + " ") || normalized.endsWith(" " + w),
      );

    if (userWantsAdvance || stageComplete) {
      return { action: "advance", messages };
    }
  }
}

async function runOpenConversation(
  rl: readline.Interface,
  gateway: ProvisionalGateway,
  bootstrap: BootstrapResult,
  systemPrompt: string,
  initialTrigger: string,
  modeConfig?: ModeConfig,
): Promise<Message[]> {
  const messages: Message[] = [{ role: "user", content: initialTrigger }];

  while (true) {
    process.stdout.write("  (pensando...)\r");
    const aiText = await callAI(gateway, bootstrap, systemPrompt, messages, modeConfig);
    process.stdout.write("                \r");

    printAiMessage(aiText);
    messages.push({ role: "assistant", content: aiText });

    const conversationComplete =
      aiText.includes("[ETAPA_COMPLETA]") || aiText.includes("[SIGUIENTE_ETAPA]");
    if (conversationComplete) {
      return messages;
    }

    const userInput = await new Promise<string>((resolve) => {
      rl.question("  " + t.brandDim("Tú:") + " ", resolve);
    });
    messages.push({ role: "user", content: userInput });
  }
}

// ── Extracción de datos estructurados ────────────────────────────────────

/**
 * Limpia una cadena que puede contener bloques markdown (```json...```) u
 * otro texto antes/después del JSON, y devuelve solo el JSON puro.
 */
function stripToJson(raw: string): string {
  // 1. Extraer contenido de bloque de código markdown si lo hay
  const mdBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = mdBlock ? mdBlock[1] : raw;

  // 2. Recortar desde el primer { o [ hasta el último } o ]
  const firstBrace = Math.min(
    text.indexOf("{") === -1 ? Infinity : text.indexOf("{"),
    text.indexOf("[") === -1 ? Infinity : text.indexOf("["),
  );
  const lastBrace = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));

  if (firstBrace === Infinity || lastBrace === -1 || lastBrace < firstBrace) {
    return text.trim();
  }

  return text.slice(firstBrace, lastBrace + 1).trim();
}

async function extractJson<T>(
  gateway: ProvisionalGateway,
  bootstrap: BootstrapResult,
  conversationMessages: Message[],
  extractionInstruction: string,
  fallback: T,
): Promise<T> {
  const extractionSystem =
    "Eres un extractor de datos estructurados. " +
    "IMPORTANTE: responde SOLO con el objeto JSON puro. " +
    "Sin bloques de código markdown, sin texto antes ni después, sin explicaciones. " +
    "Empieza directamente con { o [ y termina con } o ].";

  const extractionRequest =
    extractionInstruction +
    "\n\nResponde ÚNICAMENTE con el JSON. " +
    "No uses ```json ni ```. No escribas nada antes ni después del JSON.";

  const attemptParse = (raw: string): T | null => {
    try {
      return JSON.parse(stripToJson(raw)) as T;
    } catch {
      return null;
    }
  };

  try {
    const raw = await callAI(gateway, bootstrap, extractionSystem, [
      ...conversationMessages,
      { role: "user", content: extractionRequest },
    ]);

    const result = attemptParse(raw);
    if (result !== null) {
      return result;
    }

    // Segundo intento con instrucción aún más explícita
    const raw2 = await callAI(gateway, bootstrap, extractionSystem, [
      ...conversationMessages,
      { role: "user", content: extractionRequest },
      { role: "assistant", content: raw },
      {
        role: "user",
        content:
          "Tu respuesta anterior contiene texto extra o markdown. " +
          "Devuelve SOLO el JSON, empezando por { y terminando por }. " +
          "Sin ningún texto adicional.",
      },
    ]);

    const result2 = attemptParse(raw2);
    if (result2 !== null) {
      return result2;
    }

    console.warn(
      "  Aviso: no se pudo extraer datos estructurados de esta etapa. Usando valores por defecto.",
    );
    return fallback;
  } catch {
    console.warn(
      "  Aviso: no se pudo extraer datos estructurados de esta etapa. Usando valores por defecto.",
    );
    return fallback;
  }
}

// ── Función principal ─────────────────────────────────────────────────────

interface ConversationData {
  company: CompanyProfile;
  access: AccessModel;
  services: ServiceSelection;
  security: SecurityPolicy;
  compliance: DataCompliance;
  network: NetworkConfig;
  users: UserConfig[];
}

const GUIDED_STAGE_LABELS = [
  "Revisión del servidor",
  "Perfil de la organización",
  "Roles y usuarios",
  "Servicios a instalar",
  "Política de seguridad",
  "Datos y cumplimiento",
  "Plan final",
];

const GUIDED_STAGE_FILES = [
  "00-system-context.md",
  "01-company-profile.md",
  "02-access-model.md",
  "03-services-selection.md",
  "04-security-policy.md",
  "05-data-compliance.md",
  "06-plan-generation.md",
];

function createDefaultConversationData(scan: SystemScan): ConversationData {
  return {
    company: {
      name: scan.os.hostname,
      sector: "Organización",
      teamSize: 10,
      language: "es",
      timezone: "Europe/Madrid",
    },
    access: {
      totalUsers: 5,
      roles: [{ name: "usuarios", count: 5 }],
      remoteUsers: 0,
      devices: ["linux", "windows"],
      needsVpn: false,
      needsMfa: false,
    },
    services: {
      dns: true,
      ldap: true,
      samba: true,
      wireguard: false,
      docker: true,
      nginx: false,
      cockpit: true,
      backups: true,
    },
    security: {
      passwordComplexity: "medium",
      diskEncryption: false,
      internetExposed: false,
      sshKeyOnly: false,
    },
    compliance: {
      gdpr: false,
      backupRetentionDays: 14,
      dataTypes: [],
      jurisdiction: "ES",
    },
    network: {
      serverIp: scan.network.localIp,
      subnet: scan.network.subnet,
      gateway: scan.network.gateway,
      internalDomain: `${scan.os.hostname}.local`,
      vpnRange: "10.10.10.0/24",
      dhcpRange: scan.network.localIp.split(".").slice(0, 3).join(".") + ".100-200",
    },
    users: [],
  };
}

function cloneConversationData(data: ConversationData): ConversationData {
  return JSON.parse(JSON.stringify(data)) as ConversationData;
}

function buildCollectedContext(data: ConversationData): string {
  const roles =
    data.access.roles.length > 0
      ? data.access.roles.map((role) => `${role.name} (${role.count})`).join(", ")
      : "por definir";
  const selectedServices = Object.entries(data.services)
    .filter(([, enabled]) => enabled)
    .map(([service]) => service)
    .join(", ");

  return [
    "CONTEXTO ACUMULADO HASTA AHORA:",
    `Organización: ${data.company.name} | Sector: ${data.company.sector} | Personas: ${data.company.teamSize} | Idioma: ${data.company.language}`,
    `Roles: ${roles}`,
    `Usuarios con nombre: ${data.users.length > 0 ? data.users.map((user) => user.username).join(", ") : "por definir"}`,
    `Acceso remoto: ${data.access.remoteUsers > 0 ? `${data.access.remoteUsers} persona(s)` : "ninguno"}`,
    `Servicios seleccionados: ${selectedServices || "por definir"}`,
    `Seguridad: ${data.security.internetExposed ? "IP pública" : "red local"} | Contraseñas ${data.security.passwordComplexity} | SSH ${data.security.sshKeyOnly ? "solo clave" : "por definir"}`,
    `Backups: ${data.compliance.backupRetentionDays} días | GDPR: ${data.compliance.gdpr ? "sí" : "no"}`,
    `Red: ${data.network.serverIp} | ${data.network.internalDomain} | VPN ${data.network.vpnRange}`,
  ].join("\n");
}

async function extractConversationData(
  gateway: ProvisionalGateway,
  bootstrap: BootstrapResult,
  conversationMessages: Message[],
  currentData: ConversationData,
  scan: SystemScan,
): Promise<ConversationData> {
  const next = cloneConversationData(currentData);

  next.company = await extractJson<CompanyProfile>(
    gateway,
    bootstrap,
    conversationMessages,
    `Extrae de toda la conversación el perfil de la organización y devuelve este JSON:
{
  "name": "<nombre de la organización>",
  "sector": "<actividad o sector>",
  "teamSize": <número entero de personas>,
  "language": "<código de idioma: es, en, ca, fr...>",
  "timezone": "<zona horaria IANA, ej: Europe/Madrid>"
}`,
    next.company,
  );

  next.access = await extractJson<AccessModel>(
    gateway,
    bootstrap,
    conversationMessages,
    `Extrae de toda la conversación el modelo de acceso y devuelve este JSON:
{
  "totalUsers": <número entero>,
  "roles": [{"name": "<nombre exacto del rol o departamento>", "count": <número>}],
  "remoteUsers": <número de usuarios que acceden en remoto>,
  "devices": ["<tipo de dispositivo>"],
  "needsVpn": <true|false>,
  "needsMfa": <true|false>
}`,
    next.access,
  );

  next.users = await extractJson<UserConfig[]>(
    gateway,
    bootstrap,
    conversationMessages,
    `Si en la conversación se mencionaron nombres de personas, extrae la lista de usuarios.
Devuelve un array JSON. Si no se mencionaron nombres concretos, devuelve []:
[
  {
    "username": "<usuario en minúsculas, ej: ${INSTALLER_USERNAME_EXAMPLE}>",
    "role": "<nombre exacto del rol o departamento>",
    "remote": <true si trabaja en remoto habitualmente, false si no>
  }
]`,
    next.users,
  );

  next.services = await extractJson<ServiceSelection>(
    gateway,
    bootstrap,
    conversationMessages,
    `Extrae de la conversación los servicios seleccionados y devuelve este JSON:
{
  "dns": <true|false>,
  "ldap": <true|false>,
  "samba": <true|false>,
  "wireguard": <true|false>,
  "docker": <true|false>,
  "nginx": <true|false>,
  "cockpit": <true|false>,
  "backups": <true|false>
}`,
    next.services,
  );

  const suggestedDomain = (next.company.name || scan.os.hostname)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  next.network = await extractJson<NetworkConfig>(
    gateway,
    bootstrap,
    conversationMessages,
    `Extrae la configuración de red confirmada en la conversación y devuelve este JSON:
{
  "serverIp": "<IP del servidor confirmada, por defecto: ${scan.network.localIp}>",
  "subnet": "<máscara de subred, por defecto: ${scan.network.subnet}>",
  "gateway": "<gateway, por defecto: ${scan.network.gateway}>",
  "internalDomain": "<dominio interno elegido, ej: ${suggestedDomain || scan.os.hostname}.local>",
  "vpnRange": "<rango VPN para WireGuard, ej: 10.10.10.0/24>",
  "dhcpRange": "<rango DHCP, ej: ${next.network.dhcpRange}>"
}`,
    next.network,
  );

  next.security = await extractJson<SecurityPolicy>(
    gateway,
    bootstrap,
    conversationMessages,
    `Extrae de la conversación la política de seguridad y devuelve este JSON:
{
  "passwordComplexity": "<basic|medium|high>",
  "diskEncryption": <true|false>,
  "internetExposed": <true|false>,
  "sshKeyOnly": <true|false>
}`,
    next.security,
  );

  next.compliance = await extractJson<DataCompliance>(
    gateway,
    bootstrap,
    conversationMessages,
    `Extrae de la conversación los datos de cumplimiento normativo y devuelve este JSON:
{
  "gdpr": <true|false>,
  "backupRetentionDays": <número de días>,
  "dataTypes": ["<tipo de dato>"],
  "jurisdiction": "<código de país ISO: ES, EU, US...>"
}`,
    next.compliance,
  );

  return next;
}

// ── Extracción de intención agentic ──────────────────────────────────────

/**
 * Extrae los metadatos agenticos de la conversación:
 * objetivo, hechos confirmados, huecos y contradicciones.
 * Devuelve un ConversationIntent que puede alimentar tanto el motor
 * agentic como el plan-generator de fallback.
 */
async function extractConversationIntent(
  gateway: ProvisionalGateway,
  bootstrap: BootstrapResult,
  allMessages: Message[],
  data: ConversationData,
  scan: SystemScan,
  mode: InstallMode,
): Promise<ConversationIntent> {
  // Reutilizar la extracción existente para el InstallerConfig de fallback
  const finalData = await extractConversationData(gateway, bootstrap, allMessages, data, scan);
  const installerConfig: InstallerConfig = {
    company: finalData.company,
    access: finalData.access,
    services: finalData.services,
    security: finalData.security,
    compliance: finalData.compliance,
    network: finalData.network,
    users: finalData.users,
    installMode: mode,
  };

  const goal: InstallationGoal = {
    companyName: finalData.company.name,
    installMode: mode,
    targetHostname: scan.os.hostname,
    targetDomain: finalData.network.internalDomain,
    desiredServices: Object.entries(finalData.services)
      .filter(([, enabled]) => enabled)
      .map(([service]) => service),
    remoteAccessRequired:
      finalData.access.remoteUsers > 0 || finalData.access.needsVpn || finalData.services.wireguard,
    desiredUsers: finalData.users,
  };

  const aiConfirmedFacts = await extractJson<ConversationFact[]>(
    gateway,
    bootstrap,
    allMessages,
    `Lista los datos que el administrador confirmó explícitamente durante la conversación.
Devuelve un array JSON. Si no hay ninguno, devuelve []:
[
  {
    "key": "<nombre del dato, ej: company.name>",
    "value": "<valor confirmado>",
    "confidence": "confirmed",
    "source": "<cita textual o paráfrasis de cómo lo dijo el administrador>"
  }
]
Solo incluye datos que el administrador dijo directamente, no deducidos.`,
    [],
  );

  const aiPendingGaps = await extractJson<ConversationGap[]>(
    gateway,
    bootstrap,
    allMessages,
    `Lista los datos que quedaron sin confirmar o sin respuesta en la conversación.
Devuelve un array JSON. Si todo quedó cubierto, devuelve []:
[
  {
    "key": "<nombre del dato faltante>",
    "description": "<qué falta saber>",
    "blocking": <true si bloquea la instalación, false si tiene default seguro>
  }
]`,
    [],
  );

  const aiContradictions = await extractJson<ConversationContradiction[]>(
    gateway,
    bootstrap,
    allMessages,
    `Lista las contradicciones detectadas en la conversación.
Devuelve un array JSON. Si no hubo contradicciones, devuelve []:
[
  {
    "key": "<dato afectado>",
    "firstStatement": "<lo que se dijo primero>",
    "laterStatement": "<lo que se dijo después y contradice>",
    "resolution": "<cómo quedó resuelto, o cadena vacía si no se resolvió>"
  }
]`,
    [],
  );

  const artifacts = buildConversationArtifacts({
    messages: allMessages,
    data: finalData,
    scan,
    mode,
    aiFacts: aiConfirmedFacts,
    aiGaps: aiPendingGaps,
    aiContradictions: aiContradictions,
  });

  return {
    mode,
    goal,
    summary: artifacts.summary,
    confirmedFacts: artifacts.confirmedFacts,
    pendingGaps: artifacts.pendingGaps,
    contradictions: artifacts.contradictions,
    decisions: artifacts.decisions,
    installerConfig,
    conversationMessages: allMessages,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Ejecuta la configuración conversacional completa: 7 etapas con la IA.
 * Navega hacia adelante con 'continuar'/'siguiente' y hacia atrás con 'atrás'/'volver'.
 * La única forma de salir es Ctrl+C.
 * Devuelve ConversationIntent con la configuración y los metadatos agenticos.
 */
export async function runConversation(
  bootstrap: BootstrapResult,
  scan: SystemScan,
  mode: InstallMode = "adaptive",
  gateway?: ProvisionalGateway,
): Promise<ConversationResult> {
  if (!gateway) {
    throw new Error("El gateway provisional es obligatorio para la conversación del instalador.");
  }
  console.log(t.section("CONFIGURACIÓN CON LAIA ARCH"));
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Ctrl+C es la única salida
  rl.on("SIGINT", () => {
    console.log("\n\n  Instalación cancelada.");
    rl.close();
    process.exit(1);
  });

  const useReasoning = bootstrap.supportsReasoning ?? isReasoningModel(bootstrap.model);
  const modeConfig = getModeConfig(mode, scan);
  let data = createDefaultConversationData(scan);
  const allMessages: Message[] = [];

  try {
    if (mode === "guided") {
      const guidedPromptDir = createGuidedPromptSessionDir();
      console.log(
        t.dim(
          "\n  Modo Asistido: etapas fijas en orden estricto." +
            "\n  Cuando una etapa quede clara, Laia avanzará sola." +
            "\n  Los prompts de esta instalación se han copiado a una sesión independiente." +
            '\n  Para volver a la etapa anterior escribe "atrás".' +
            "\n  Ctrl+C para cancelar en cualquier momento.\n",
        ),
      );
      console.log(`  ${t.muted(`Sesión de prompts: ${guidedPromptDir}`)}\n`);

      const snapshots: ConversationData[] = [cloneConversationData(data)];
      let stageIndex = 0;

      while (stageIndex < GUIDED_STAGE_FILES.length) {
        console.log(t.step(`Configurando: ${GUIDED_STAGE_LABELS[stageIndex]}\n`));

        let systemPrompt = [
          modeConfig.systemPrompt,
          `PROMPT DE ETAPA ACTUAL — ${GUIDED_STAGE_LABELS[stageIndex]}:`,
          loadPrompt(GUIDED_STAGE_FILES[stageIndex], guidedPromptDir),
          buildCollectedContext(data),
        ].join("\n\n");
        if (useReasoning) {
          systemPrompt += REASONING_SUFFIX;
        }

        const trigger =
          `Estamos en ${GUIDED_STAGE_LABELS[stageIndex]}. ` +
          "Sigue exactamente el prompt de esta etapa. " +
          "No avances hasta entender al 100% al administrador y recibir confirmación explícita. " +
          "Cuando la etapa esté realmente cerrada, termina tu último mensaje con [ETAPA_COMPLETA].";

        const outcome = await runStage(rl, gateway, bootstrap, systemPrompt, trigger, modeConfig);

        if (outcome.action === "back") {
          if (stageIndex > 0) {
            stageIndex--;
            data = cloneConversationData(snapshots[stageIndex] ?? data);
            console.log(t.dim("  Volviendo a la etapa anterior...\n"));
          } else {
            console.log(t.dim("  Ya estás en la primera etapa.\n"));
          }
          continue;
        }

        allMessages.push(...outcome.messages);
        data = await extractConversationData(gateway, bootstrap, allMessages, data, scan);
        stageIndex++;
        snapshots[stageIndex] = cloneConversationData(data);
      }
    } else {
      console.log(
        t.dim(
          mode === "tool-driven"
            ? "\n  Modo Automático: Laia hará 5 preguntas exactas y luego continuará.\n"
            : "\n  Modo Adaptativo: Laia se adaptará a lo que cuentes, sin orden fijo.\n",
        ),
      );

      let systemPrompt = modeConfig.systemPrompt;
      if (mode === "adaptive") {
        systemPrompt = [modeConfig.systemPrompt, buildCollectedContext(data)].join("\n\n");
      }
      if (useReasoning) {
        systemPrompt += REASONING_SUFFIX;
      }

      const trigger =
        mode === "tool-driven"
          ? 'Empieza con la pregunta 1 exactamente como está escrita. Haz una sola pregunta cada vez. Cuando tengas las 5 respuestas, resume lo entendido y termina con "[ETAPA_COMPLETA]".'
          : "Empieza confirmando el servidor o preguntando por el dato más importante que falte. Haz una sola pregunta cada vez. No cierres si queda una contradiccion relevante o un hueco bloqueante sin resolver. Cuando tengas la informacion necesaria para el plan, resume organizacion, roles, servicios y el resultado esperado host + Agora base, y termina con [ETAPA_COMPLETA].";

      const messages = await runOpenConversation(
        rl,
        gateway,
        bootstrap,
        systemPrompt,
        trigger,
        modeConfig,
      );
      allMessages.push(...messages);
      data = await extractConversationData(gateway, bootstrap, allMessages, data, scan);
    }

    rl.close();

    data = await extractConversationData(gateway, bootstrap, allMessages, data, scan);

    const intent = await extractConversationIntent(
      gateway,
      bootstrap,
      allMessages,
      data,
      scan,
      mode,
    );
    const config = intent.installerConfig;

    // Guardar la configuración en ~/.laia-arch/
    const configDir = path.join(os.homedir(), ".laia-arch");
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, "installer-config.json");
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    const intentPath = path.join(configDir, "installer-intent.json");
    fs.writeFileSync(intentPath, JSON.stringify(intent, null, 2), { mode: 0o600 });
    console.log(`\n  Configuración guardada en ${configPath}`);
    console.log(`  ${t.muted(`Intención guardada en ${intentPath}`)}`);
    console.log();
    console.log(t.dim(buildArchAgoraOutcomeMessage(intent)));

    return { config, intent };
  } catch (err) {
    rl.close();
    throw err;
  }
}
