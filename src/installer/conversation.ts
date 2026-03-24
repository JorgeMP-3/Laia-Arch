// conversation.ts — Fase 2: Conversación con la IA para recopilar la configuración
// La IA guía al administrador a través de 6 etapas. Nunca ve contraseñas.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import { extractCredentialValue, retrieveProfileCredential } from "./credential-manager.js";
import type {
  AccessModel,
  BootstrapResult,
  CompanyProfile,
  DataCompliance,
  InstallerConfig,
  NetworkConfig,
  SecurityPolicy,
  ServiceSelection,
  SystemScan,
  UserConfig,
} from "./types.js";

// Los prompts están en install-prompts/ en la raíz del repo.
// En dist/ estaremos en dist/installer/, así que subimos dos niveles.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPTS_DIR = path.resolve(__dirname, "../install-prompts");

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
  if (reasoningModels.has(model)) return true;
  const lower = model.toLowerCase();
  return lower.includes("reasoner") || lower.includes("thinking");
}

const REASONING_SUFFIX =
  "\n\nRazona internamente sobre la configuración óptima antes de responder. Sé conciso en las respuestas al usuario.";

// Prompts compactos para modelos de reasoning (reemplazan archivos largos para ahorrar tokens)
const COMPACT_PROMPTS = {
  company:
    "Eres Laia Arch. Recoge en conversación: nombre de la agencia, número de empleados, idioma principal. " +
    "Confirma con resumen de una línea antes de avanzar. Menos de 3 intercambios.",
  access:
    "Eres Laia Arch. El ecosistema LAIA usa tres roles fijos: creativos, cuentas, comerciales. " +
    "Pregunta cuántas personas hay en cada rol y si alguno trabaja en remoto (activa WireGuard). " +
    "Si mencionan nombres, recuérdalos para sugerir usuario en formato nombre.apellido.",
  security:
    "Eres Laia Arch. Tres preguntas concretas: " +
    "1) ¿IP pública o solo red local? " +
    "2) ¿Contraseñas automáticas generadas por Laia? " +
    "3) ¿Solo SSH por clave sin contraseña? Explica cada opción en una frase.",
  compliance:
    "Eres Laia Arch. Una pregunta: ¿la agencia maneja datos de clientes? " +
    "Si sí, informa que GDPR aplica y el ecosistema LAIA cumple por diseño. " +
    "Pregunta cuántos días conservar backups (sugerir 30). Confirma y avanza.",
};

// ── Cliente IA unificado ──────────────────────────────────────────────────

/** Envía un turno al proveedor de IA y devuelve el texto de la respuesta. */
async function callAI(
  bootstrap: BootstrapResult,
  systemPrompt: string,
  messages: Message[],
): Promise<string> {
  const key =
    bootstrap.providerId !== "ollama"
      ? extractCredentialValue(retrieveProfileCredential(bootstrap.profileId))
      : "";

  // supportsReasoning de bootstrap tiene prioridad; si no está, detectamos por nombre
  const useReasoning = bootstrap.supportsReasoning ?? isReasoningModel(bootstrap.model);

  if (bootstrap.providerId === "anthropic") {
    // setup-token es OAuth: usa Authorization: Bearer en lugar de x-api-key
    const anthropicHeaders: Record<string, string> =
      bootstrap.authMethod === "setup-token"
        ? {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            "anthropic-version": "2023-06-01",
          }
        : {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          };
    const anthropicBody: Record<string, unknown> = {
      model: bootstrap.model,
      max_tokens: useReasoning ? 8000 : 2048,
      system: systemPrompt,
      messages,
    };
    if (useReasoning) {
      // extended thinking requiere temperature: 1 y el bloque thinking
      anthropicBody.temperature = 1;
      anthropicBody.thinking = { type: "enabled", budget_tokens: 5000 };
    }
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders,
      body: JSON.stringify(anthropicBody),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    // Filtramos bloques thinking; solo queremos el texto visible
    return data.content.find((b) => b.type === "text")?.text ?? "";
  }

  if (
    bootstrap.providerId === "openai" ||
    bootstrap.providerId === "deepseek" ||
    bootstrap.providerId === "openai-compatible" ||
    bootstrap.providerId === "openrouter"
  ) {
    const baseUrl =
      bootstrap.baseUrl ??
      (bootstrap.providerId === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : bootstrap.providerId === "deepseek"
          ? "https://api.deepseek.com/v1"
          : "https://api.openai.com/v1");
    const openaiBody: Record<string, unknown> = {
      model: bootstrap.model,
      max_tokens: useReasoning ? 8000 : 2048,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    };
    if (!useReasoning) {
      // temperature: 0.3 solo para modelos estándar; o1/o3 no lo aceptan
      openaiBody.temperature = 0.3;
    }
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key || "none"}`,
      },
      body: JSON.stringify(openaiBody),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI API ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content ?? "";
  }

  if (bootstrap.providerId === "ollama") {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: bootstrap.model,
        stream: false,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        options: { temperature: 0.3 },
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama API ${response.status}`);
    }
    const data = (await response.json()) as { message: { content: string } };
    return data.message?.content ?? "";
  }

  throw new Error(`Proveedor no soportado: ${bootstrap.providerId}`);
}

// ── Utilidades ────────────────────────────────────────────────────────────

function loadPrompt(name: string): string {
  const filePath = path.join(PROMPTS_DIR, name);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    console.warn(`  Aviso: no se pudo cargar el prompt ${name}`);
    return "";
  }
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
  bootstrap: BootstrapResult,
  systemPrompt: string,
  initialTrigger: string,
): Promise<StageOutcome> {
  const messages: Message[] = [{ role: "user", content: initialTrigger }];

  while (true) {
    // Llamar a la IA con el historial actual
    process.stdout.write("  (pensando...)\r");
    const aiText = await callAI(bootstrap, systemPrompt, messages);
    process.stdout.write("                \r");

    printAiMessage(aiText);
    messages.push({ role: "assistant", content: aiText });

    // La IA puede señalar que la etapa está completa
    const stageComplete =
      aiText.includes("[ETAPA_COMPLETA]") || aiText.includes("[SIGUIENTE_ETAPA]");

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

// ── Extracción de datos estructurados ────────────────────────────────────

/**
 * Tras cada etapa, hace una llamada de extracción separada para convertir
 * la conversación en datos estructurados JSON.
 * Si la extracción falla, devuelve el fallback sin interrumpir el flujo.
 */
async function extractJson<T>(
  bootstrap: BootstrapResult,
  conversationMessages: Message[],
  extractionInstruction: string,
  fallback: T,
): Promise<T> {
  const extractionSystem =
    "Eres un extractor de datos estructurados. " +
    "Tu única función es devolver JSON válido, sin explicaciones, sin bloques de código markdown, " +
    "sin texto adicional antes ni después. Solo el objeto JSON.";

  const extractionRequest =
    extractionInstruction +
    "\n\nDevuelve únicamente el JSON. Sin explicaciones. Sin ```json. Solo el objeto.";

  try {
    const raw = await callAI(bootstrap, extractionSystem, [
      ...conversationMessages,
      { role: "user", content: extractionRequest },
    ]);

    // Limpiar por si acaso el modelo añade bloques de código
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    return JSON.parse(cleaned) as T;
  } catch {
    console.warn(
      "  Aviso: no se pudo extraer datos estructurados de esta etapa. Usando valores por defecto.",
    );
    return fallback;
  }
}

// ── Función principal ─────────────────────────────────────────────────────

const STAGE_LABELS = [
  "Revisión del sistema",
  "Perfil de la empresa",
  "Modelo de acceso",
  "Servicios a instalar",
  "Configuración de red",
  "Política de seguridad",
  "Cumplimiento normativo",
];

/**
 * Ejecuta la Fase 2 completa: 6 etapas conversacionales con la IA.
 * Navega hacia adelante con 'continuar'/'siguiente' y hacia atrás con 'atrás'/'volver'.
 * La única forma de salir es Ctrl+C.
 * Devuelve InstallerConfig con todos los datos recopilados.
 */
export async function runConversation(
  bootstrap: BootstrapResult,
  scan: SystemScan,
): Promise<InstallerConfig> {
  console.log(t.section("FASE 2 — CONVERSACIÓN CON LA IA"));
  console.log(t.dim(
    '\n  Cuando hayas confirmado esta etapa escribe "continuar".' +
    '\n  Para volver a la etapa anterior escribe "atrás".' +
    '\n  Ctrl+C para cancelar en cualquier momento.\n',
  ));

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

  const scanContext = formatScan(scan);

  // Datos extraídos de cada etapa (se actualizan al avanzar, se reutilizan al volver)
  let company: CompanyProfile = {
    name: scan.os.hostname,
    sector: "Servicios",
    teamSize: 10,
    language: "es",
    timezone: "Europe/Madrid",
  };
  let access: AccessModel = {
    totalUsers: 5,
    roles: [
      { name: "administrador", count: 1 },
      { name: "usuario", count: 4 },
    ],
    remoteUsers: 0,
    devices: ["linux", "windows"],
    needsVpn: false,
    needsMfa: false,
  };
  let services: ServiceSelection = {
    dns: true,
    ldap: true,
    samba: true,
    wireguard: false,
    docker: false,
    nginx: true,
    cockpit: true,
    backups: true,
  };
  let security: SecurityPolicy = {
    passwordComplexity: "medium",
    diskEncryption: false,
    internetExposed: false,
    sshKeyOnly: true,
  };
  let compliance: DataCompliance = {
    gdpr: true,
    backupRetentionDays: 30,
    dataTypes: ["documentos de trabajo"],
    jurisdiction: "ES",
  };
  let network: NetworkConfig = {
    serverIp: scan.network.localIp,
    subnet: scan.network.subnet,
    gateway: scan.network.gateway,
    internalDomain: `${scan.os.hostname}.local`,
    vpnRange: "10.10.10.0/24",
    dhcpRange: scan.network.localIp.split(".").slice(0, 3).join(".") + ".100-200",
  };
  let users: UserConfig[] = [];

  const useReasoning = bootstrap.supportsReasoning ?? isReasoningModel(bootstrap.model);

  let stageIndex = 0;

  try {
    while (stageIndex < 7) {
      console.log(t.step(`Etapa ${stageIndex}/5: ${STAGE_LABELS[stageIndex]}\n`));

      // Construir el prompt del sistema según la etapa actual
      let systemPrompt: string;
      let trigger: string;

      switch (stageIndex) {
        case 0: {
          const p0 = loadPrompt("00-system-context.md");
          systemPrompt = p0 + "\n\n" + scanContext;
          if (useReasoning) systemPrompt += REASONING_SUFFIX;
          trigger =
            "Por favor, presenta el estado actual del servidor de forma clara y no técnica, " +
            "señalando las advertencias importantes. Al terminar, pregunta si podemos continuar.";
          break;
        }
        case 1: {
          const p1 = useReasoning
            ? COMPACT_PROMPTS.company
            : loadPrompt("01-company-profile.md");
          systemPrompt = p1 + "\n\n" + scanContext;
          if (useReasoning) systemPrompt += REASONING_SUFFIX;
          trigger =
            "Comienza recopilando el perfil de la empresa. " +
            `El hostname actual es "${scan.os.hostname}".`;
          break;
        }
        case 2: {
          const p2 = useReasoning
            ? COMPACT_PROMPTS.access
            : loadPrompt("02-access-model.md");
          systemPrompt = p2 + "\n\nEmpresa: " + JSON.stringify(company) + "\n\n" + scanContext;
          if (useReasoning) systemPrompt += REASONING_SUFFIX;
          trigger =
            "Ahora necesitamos definir quién tendrá acceso al servidor: " +
            "usuarios, roles, acceso remoto y dispositivos.";
          break;
        }
        case 3: {
          const p3 = loadPrompt("03-services-selection.md");
          systemPrompt =
            p3 +
            "\n\nEmpresa: " +
            JSON.stringify(company) +
            "\nAcceso: " +
            JSON.stringify(access) +
            "\n\n" +
            scanContext;
          if (useReasoning) systemPrompt += REASONING_SUFFIX;
          trigger =
            "Basándote en el perfil del equipo, sugiere qué servicios instalar " +
            "explicando cada uno en términos sencillos.";
          break;
        }
        case 4: {
          // Etapa nueva: confirmar configuración de red con el administrador
          const suggestedDomain = company.name
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "");
          systemPrompt = [
            "Eres Laia Arch, agente de configuración del ecosistema LAIA.",
            "Confirma la configuración de red del servidor con el administrador.",
            "",
            `1. Confirma que la IP del servidor es ${scan.network.localIp} y el gateway ${scan.network.gateway}.`,
            `2. Propón el dominio interno: ${suggestedDomain}.local — pregunta si prefieren otro nombre.`,
            services.wireguard
              ? "3. Para WireGuard, propón el rango VPN: 10.10.10.0/24 — pregunta si prefieren otro."
              : "",
            "",
            `Empresa: ${JSON.stringify(company)}`,
            `Servicios seleccionados: ${JSON.stringify(services)}`,
            "",
            scanContext,
          ]
            .filter(Boolean)
            .join("\n");
          if (useReasoning) systemPrompt += REASONING_SUFFIX;
          trigger = `La IP detectada del servidor es ${scan.network.localIp}. Confirma con el administrador la configuración de red.`;
          break;
        }
        case 5: {
          // Seguridad (era etapa 4)
          const p5 = useReasoning
            ? COMPACT_PROMPTS.security
            : loadPrompt("04-security-policy.md");
          systemPrompt =
            p5 +
            "\n\nServicios seleccionados: " +
            JSON.stringify(services) +
            "\n\n" +
            scanContext;
          if (useReasoning) systemPrompt += REASONING_SUFFIX;
          trigger =
            "Define la política de seguridad del servidor: contraseñas, exposición a internet y SSH.";
          break;
        }
        default: {
          // 6 — Cumplimiento (era etapa 5)
          const p6 = useReasoning
            ? COMPACT_PROMPTS.compliance
            : loadPrompt("05-data-compliance.md");
          systemPrompt = p6 + "\n\n" + scanContext;
          if (useReasoning) systemPrompt += REASONING_SUFFIX;
          trigger =
            "Por último, revisemos los requisitos de protección de datos y cumplimiento normativo.";
          break;
        }
      }

      const outcome = await runStage(rl, bootstrap, systemPrompt, trigger);

      if (outcome.action === "back") {
        if (stageIndex > 0) {
          stageIndex--;
          console.log(t.dim("  Volviendo a la etapa anterior...\n"));
        } else {
          console.log(t.dim("  Ya estás en la primera etapa.\n"));
        }
        continue;
      }

      // Extraer datos estructurados de la conversación de esta etapa
      switch (stageIndex) {
        case 1:
          company = await extractJson<CompanyProfile>(
            bootstrap,
            outcome.messages,
            `Extrae de la conversación anterior los datos del perfil de la empresa y devuelve este JSON:
{
  "name": "<nombre de la empresa>",
  "sector": "<sector o industria>",
  "teamSize": <número entero de personas>,
  "language": "<código de idioma: es, en, ca, fr...>",
  "timezone": "<zona horaria IANA, ej: Europe/Madrid>"
}`,
            company,
          );
          break;
        case 2:
          access = await extractJson<AccessModel>(
            bootstrap,
            outcome.messages,
            `Extrae de la conversación el modelo de acceso y devuelve este JSON:
{
  "totalUsers": <número entero>,
  "roles": [{"name": "<nombre del rol>", "count": <número>}],
  "remoteUsers": <número de usuarios que acceden en remoto>,
  "devices": ["<tipo de dispositivo>"],
  "needsVpn": <true|false>,
  "needsMfa": <true|false>
}`,
            access,
          );
          // Extraer usuarios si el administrador mencionó nombres de personas
          users = await extractJson<UserConfig[]>(
            bootstrap,
            outcome.messages,
            `Si en la conversación se mencionaron nombres de personas, extrae la lista de usuarios.
Devuelve un array JSON. Si no se mencionaron nombres concretos, devuelve []:
[
  {
    "username": "<nombre.apellido en minúsculas, ej: ana.garcia>",
    "role": "<creativos|cuentas|comerciales>",
    "remote": <true si trabaja en remoto habitualmente, false si no>
  }
]`,
            users,
          );
          break;
        case 3:
          services = await extractJson<ServiceSelection>(
            bootstrap,
            outcome.messages,
            `Extrae de la conversación los servicios seleccionados y devuelve este JSON (todos boolean):
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
            services,
          );
          break;
        case 4: {
          // Extraer configuración de red confirmada en la conversación
          const suggestedDomain = company.name
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "");
          network = await extractJson<NetworkConfig>(
            bootstrap,
            outcome.messages,
            `Extrae la configuración de red confirmada en la conversación y devuelve este JSON:
{
  "serverIp": "<IP del servidor confirmada, por defecto: ${scan.network.localIp}>",
  "subnet": "<máscara de subred, por defecto: ${scan.network.subnet}>",
  "gateway": "<gateway, por defecto: ${scan.network.gateway}>",
  "internalDomain": "<dominio interno elegido, ej: ${suggestedDomain}.local>",
  "vpnRange": "<rango VPN para WireGuard, ej: 10.10.10.0/24>",
  "dhcpRange": "<rango DHCP, ej: ${network.dhcpRange}>"
}`,
            network,
          );
          break;
        }
        case 5:
          security = await extractJson<SecurityPolicy>(
            bootstrap,
            outcome.messages,
            `Extrae de la conversación la política de seguridad y devuelve este JSON:
{
  "passwordComplexity": "<basic|medium|high>",
  "diskEncryption": <true|false>,
  "internetExposed": <true|false>,
  "sshKeyOnly": <true|false>
}`,
            security,
          );
          break;
        case 6:
          compliance = await extractJson<DataCompliance>(
            bootstrap,
            outcome.messages,
            `Extrae de la conversación los datos de cumplimiento normativo y devuelve este JSON:
{
  "gdpr": <true|false>,
  "backupRetentionDays": <número de días>,
  "dataTypes": ["<tipo de dato>"],
  "jurisdiction": "<código de país ISO: ES, EU, US...>"
}`,
            compliance,
          );
          break;
      }

      stageIndex++;
    }

    rl.close();

    const config: InstallerConfig = { company, access, services, security, compliance, network, users };

    // Guardar la configuración en ~/.laia-arch/
    const configDir = path.join(os.homedir(), ".laia-arch");
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, "installer-config.json");
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    console.log(`\n  Configuración guardada en ${configPath}`);

    return config;
  } catch (err) {
    rl.close();
    throw err;
  }
}
