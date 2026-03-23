// conversation.ts — Fase 2: Conversación con la IA para recopilar la configuración
// La IA guía al administrador a través de 6 etapas. Nunca ve contraseñas.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import { retrieveKey } from "./bootstrap.js";
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
const PROMPTS_DIR = path.resolve(__dirname, "../../install-prompts");

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
  const key = bootstrap.providerId !== "ollama" ? retrieveKey(bootstrap.credentialId) : "";

  if (bootstrap.providerId === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
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

  if (bootstrap.providerId === "openai" || bootstrap.providerId === "openai-compatible") {
    const baseUrl = bootstrap.baseUrl ?? "https://api.openai.com";
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
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

const CANCEL_WORDS = new Set(["salir", "exit", "cancelar", "abortar", "q"]);

// ── Bucle de conversación por etapa ──────────────────────────────────────

interface StageResult {
  messages: Message[];
}

/**
 * Ejecuta una etapa conversacional.
 * El bucle termina cuando el usuario escribe una palabra de avance
 * o cuando la IA incluye [ETAPA_COMPLETA] en su respuesta.
 * La primera llamada a la IA usa initialTrigger como mensaje oculto de arranque.
 */
async function runStage(
  rl: readline.Interface,
  bootstrap: BootstrapResult,
  systemPrompt: string,
  initialTrigger: string,
): Promise<StageResult> {
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

    if (CANCEL_WORDS.has(normalized)) {
      throw new Error("Instalación cancelada por el usuario.");
    }

    messages.push({ role: "user", content: userInput });

    // Avanzar si el usuario lo indica explícitamente o si la IA marcó la etapa completa
    const userWantsAdvance =
      ADVANCE_WORDS.has(normalized) ||
      [...ADVANCE_WORDS].some(
        (w) => normalized.startsWith(w + " ") || normalized.endsWith(" " + w),
      );

    if (userWantsAdvance || stageComplete) {
      return { messages };
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

/**
 * Ejecuta la Fase 2 completa: 6 etapas conversacionales con la IA.
 * Devuelve InstallerConfig con todos los datos recopilados.
 */
export async function runConversation(
  bootstrap: BootstrapResult,
  scan: SystemScan,
): Promise<InstallerConfig> {
  console.log(t.section("FASE 2 — CONVERSACIÓN CON LA IA"));
  console.log(t.dim("\n  Escribe 'continuar' o 'siguiente' para avanzar de etapa."));
  console.log(t.dim("  Escribe 'salir' en cualquier momento para cancelar.\n"));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const scanContext = formatScan(scan);

  try {
    // ── Etapa 0: Contexto del sistema ─────────────────────────────────────
    console.log(t.step("Etapa 0/5: Revisión del sistema\n"));
    const stage0System = loadPrompt("00-system-context.md") + "\n\n" + scanContext;
    await runStage(
      rl,
      bootstrap,
      stage0System,
      "Por favor, presenta el estado actual del servidor de forma clara y no técnica, " +
        "señalando las advertencias importantes. Al terminar, pregunta si podemos continuar.",
    );

    // ── Etapa 1: Perfil de la empresa ─────────────────────────────────────
    console.log(t.step("Etapa 1/5: Perfil de la empresa\n"));
    const stage1System = loadPrompt("01-company-profile.md") + "\n\n" + scanContext;
    const { messages: msgs1 } = await runStage(
      rl,
      bootstrap,
      stage1System,
      "Comienza recopilando el perfil de la empresa. " +
        `El hostname actual es "${scan.os.hostname}".`,
    );

    const company = await extractJson<CompanyProfile>(
      bootstrap,
      msgs1,
      `Extrae de la conversación anterior los datos del perfil de la empresa y devuelve este JSON:
{
  "name": "<nombre de la empresa>",
  "sector": "<sector o industria>",
  "teamSize": <número entero de personas>,
  "language": "<código de idioma: es, en, ca, fr...>",
  "timezone": "<zona horaria IANA, ej: Europe/Madrid>"
}`,
      {
        name: scan.os.hostname,
        sector: "Servicios",
        teamSize: 10,
        language: "es",
        timezone: "Europe/Madrid",
      },
    );

    // ── Etapa 2: Modelo de acceso ─────────────────────────────────────────
    console.log(t.step("Etapa 2/5: Modelo de acceso\n"));
    const stage2System =
      loadPrompt("02-access-model.md") +
      "\n\nEmpresa: " +
      JSON.stringify(company) +
      "\n\n" +
      scanContext;
    const { messages: msgs2 } = await runStage(
      rl,
      bootstrap,
      stage2System,
      "Ahora necesitamos definir quién tendrá acceso al servidor: " +
        "usuarios, roles, acceso remoto y dispositivos.",
    );

    const access = await extractJson<AccessModel>(
      bootstrap,
      msgs2,
      `Extrae de la conversación el modelo de acceso y devuelve este JSON:
{
  "totalUsers": <número entero>,
  "roles": [{"name": "<nombre del rol>", "count": <número>}],
  "remoteUsers": <número de usuarios que acceden en remoto>,
  "devices": ["<tipo de dispositivo>"],
  "needsVpn": <true|false>,
  "needsMfa": <true|false>
}`,
      {
        totalUsers: 5,
        roles: [
          { name: "administrador", count: 1 },
          { name: "usuario", count: 4 },
        ],
        remoteUsers: 0,
        devices: ["linux", "windows"],
        needsVpn: false,
        needsMfa: false,
      },
    );

    // ── Etapa 3: Selección de servicios ───────────────────────────────────
    console.log(t.step("Etapa 3/5: Servicios a instalar\n"));
    const stage3System =
      loadPrompt("03-services-selection.md") +
      "\n\nEmpresa: " +
      JSON.stringify(company) +
      "\nAcceso: " +
      JSON.stringify(access) +
      "\n\n" +
      scanContext;
    const { messages: msgs3 } = await runStage(
      rl,
      bootstrap,
      stage3System,
      "Basándote en el perfil del equipo, sugiere qué servicios instalar " +
        "explicando cada uno en términos sencillos.",
    );

    const services = await extractJson<ServiceSelection>(
      bootstrap,
      msgs3,
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
      {
        dns: true,
        ldap: true,
        samba: true,
        wireguard: false,
        docker: false,
        nginx: true,
        cockpit: true,
        backups: true,
      },
    );

    // ── Etapa 4: Política de seguridad ────────────────────────────────────
    console.log(t.step("Etapa 4/5: Política de seguridad\n"));
    const stage4System =
      loadPrompt("04-security-policy.md") +
      "\n\nServicios seleccionados: " +
      JSON.stringify(services) +
      "\n\n" +
      scanContext;
    const { messages: msgs4 } = await runStage(
      rl,
      bootstrap,
      stage4System,
      "Define la política de seguridad del servidor: contraseñas, exposición a internet y SSH.",
    );

    const security = await extractJson<SecurityPolicy>(
      bootstrap,
      msgs4,
      `Extrae de la conversación la política de seguridad y devuelve este JSON:
{
  "passwordComplexity": "<basic|medium|high>",
  "diskEncryption": <true|false>,
  "internetExposed": <true|false>,
  "sshKeyOnly": <true|false>
}`,
      {
        passwordComplexity: "medium",
        diskEncryption: false,
        internetExposed: false,
        sshKeyOnly: true,
      },
    );

    // ── Etapa 5: Cumplimiento normativo ───────────────────────────────────
    console.log(t.step("Etapa 5/5: Cumplimiento normativo\n"));
    const stage5System = loadPrompt("05-data-compliance.md") + "\n\n" + scanContext;
    const { messages: msgs5 } = await runStage(
      rl,
      bootstrap,
      stage5System,
      "Por último, revisemos los requisitos de protección de datos y cumplimiento normativo.",
    );

    const compliance = await extractJson<DataCompliance>(
      bootstrap,
      msgs5,
      `Extrae de la conversación los datos de cumplimiento normativo y devuelve este JSON:
{
  "gdpr": <true|false>,
  "backupRetentionDays": <número de días>,
  "dataTypes": ["<tipo de dato>"],
  "jurisdiction": "<código de país ISO: ES, EU, US...>"
}`,
      {
        gdpr: true,
        backupRetentionDays: 30,
        dataTypes: ["documentos de trabajo"],
        jurisdiction: "ES",
      },
    );

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
