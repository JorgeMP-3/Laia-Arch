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
  SecurityPolicy,
  ServiceSelection,
  SystemScan,
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
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders,
      body: JSON.stringify({
        model: bootstrap.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };
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
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key || "none"}`,
      },
      body: JSON.stringify({
        model: bootstrap.model,
        max_tokens: 2048,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
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

  let stageIndex = 0;

  try {
    while (stageIndex < 6) {
      console.log(t.step(`Etapa ${stageIndex}/5: ${STAGE_LABELS[stageIndex]}\n`));

      // Construir el prompt del sistema según la etapa actual
      let systemPrompt: string;
      let trigger: string;

      switch (stageIndex) {
        case 0:
          systemPrompt = loadPrompt("00-system-context.md") + "\n\n" + scanContext;
          trigger =
            "Por favor, presenta el estado actual del servidor de forma clara y no técnica, " +
            "señalando las advertencias importantes. Al terminar, pregunta si podemos continuar.";
          break;
        case 1:
          systemPrompt = loadPrompt("01-company-profile.md") + "\n\n" + scanContext;
          trigger =
            "Comienza recopilando el perfil de la empresa. " +
            `El hostname actual es "${scan.os.hostname}".`;
          break;
        case 2:
          systemPrompt =
            loadPrompt("02-access-model.md") +
            "\n\nEmpresa: " +
            JSON.stringify(company) +
            "\n\n" +
            scanContext;
          trigger =
            "Ahora necesitamos definir quién tendrá acceso al servidor: " +
            "usuarios, roles, acceso remoto y dispositivos.";
          break;
        case 3:
          systemPrompt =
            loadPrompt("03-services-selection.md") +
            "\n\nEmpresa: " +
            JSON.stringify(company) +
            "\nAcceso: " +
            JSON.stringify(access) +
            "\n\n" +
            scanContext;
          trigger =
            "Basándote en el perfil del equipo, sugiere qué servicios instalar " +
            "explicando cada uno en términos sencillos.";
          break;
        case 4:
          systemPrompt =
            loadPrompt("04-security-policy.md") +
            "\n\nServicios seleccionados: " +
            JSON.stringify(services) +
            "\n\n" +
            scanContext;
          trigger =
            "Define la política de seguridad del servidor: contraseñas, exposición a internet y SSH.";
          break;
        default: // 5
          systemPrompt = loadPrompt("05-data-compliance.md") + "\n\n" + scanContext;
          trigger =
            "Por último, revisemos los requisitos de protección de datos y cumplimiento normativo.";
          break;
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
        case 4:
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
        case 5:
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

    const config: InstallerConfig = { company, access, services, security, compliance };

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
