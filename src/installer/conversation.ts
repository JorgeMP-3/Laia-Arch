// conversation.ts — Fase 2: Conversación con la IA para recopilar la configuración
// La IA guía al administrador a través de 6 etapas. Nunca ve contraseñas.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import { extractCredentialValue, retrieveProfileCredential } from "./credential-manager.js";
import {
  TOOL_DEFINITIONS_ANTHROPIC,
  TOOL_DEFINITIONS_OPENAI,
  TOOL_HANDLERS,
} from "./tools/index.js";
import { INSTALLER_USERNAME_EXAMPLE } from "./tools/username-policy.js";
import type {
  AccessModel,
  BootstrapResult,
  CompanyProfile,
  DataCompliance,
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
- Docker: siempre, necesario para Laia Agora y Nemo
- Backups rsync: siempre, esencial
- Samba: si comparten archivos entre equipos
- WireGuard: SOLO si hay remotos — añadir sin preguntar si ya lo confirmaron
- Nginx: si quieren acceder por nombre en lugar de IP
- Cockpit: si quieren gestión visual sin terminal

NUNCA:
- Asumir el sector ni los roles de la organización
- Avanzar sin entender completamente lo que quieren
- Simular acciones — solo ejecutar tools reales
- Generar el plan sin tener toda la información necesaria`;
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
  bootstrap: BootstrapResult,
  systemPrompt: string,
  messages: Message[],
  modeConfig?: ModeConfig,
): Promise<string> {
  const key =
    bootstrap.providerId !== "ollama"
      ? extractCredentialValue(retrieveProfileCredential(bootstrap.profileId))
      : "";

  // supportsReasoning de bootstrap tiene prioridad; si no está, detectamos por nombre
  const useReasoning = bootstrap.supportsReasoning ?? isReasoningModel(bootstrap.model);
  const maxTokens = modeConfig?.maxTokensPerCall ?? (useReasoning ? 8000 : 2048);

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

    const useTools = modeConfig?.useTools === true && !useReasoning;

    if (useTools) {
      // Bucle de tool use: la IA llama herramientas hasta que stop_reason !== "tool_use"
      type ApiContent = Record<string, unknown>;
      type ApiMsg = { role: string; content: string | ApiContent[] };
      const apiMessages: ApiMsg[] = messages.map((m) => ({ role: m.role, content: m.content }));

      while (true) {
        const body: Record<string, unknown> = {
          model: bootstrap.model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: apiMessages,
          tools: TOOL_DEFINITIONS_ANTHROPIC,
        };
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: anthropicHeaders,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          throw new Error(`Anthropic API ${response.status}: ${errBody.slice(0, 200)}`);
        }
        const data = (await response.json()) as {
          stop_reason: string;
          content: Array<{
            type: string;
            id?: string;
            name?: string;
            input?: Record<string, unknown>;
            text?: string;
          }>;
        };

        if (data.stop_reason !== "tool_use") {
          return data.content.find((b) => b.type === "text")?.text ?? "";
        }

        // Ejecutar las herramientas solicitadas
        const toolResults: ApiContent[] = [];
        for (const block of data.content.filter((b) => b.type === "tool_use")) {
          const handler = TOOL_HANDLERS[block.name ?? ""];
          let resultContent: string;
          try {
            const toolResult = handler
              ? await handler(block.input ?? {})
              : { error: `Herramienta desconocida: ${block.name}` };
            resultContent = JSON.stringify(toolResult);
          } catch (err) {
            resultContent = JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            });
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id ?? "",
            content: resultContent,
          });
        }

        // Añadir turno de la IA y resultados al historial
        apiMessages.push({ role: "assistant", content: data.content as ApiContent[] });
        apiMessages.push({ role: "user", content: toolResults });
      }
    }

    const anthropicBody: Record<string, unknown> = {
      model: bootstrap.model,
      max_tokens: maxTokens,
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

    const openaiHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key || "none"}`,
    };

    // Proveedores que usan formato OpenAI para tool use (function calling).
    // DeepSeek usa exactamente el mismo formato que OpenAI: tool_calls / role:tool.
    const usesOpenAIToolFormat =
      bootstrap.providerId === "openai" ||
      bootstrap.providerId === "openrouter" ||
      bootstrap.providerId === "deepseek" ||
      bootstrap.providerId === "openai-compatible";
    const useToolsOpenAI = modeConfig?.useTools === true && !useReasoning && usesOpenAIToolFormat;

    if (useToolsOpenAI) {
      // Bucle de tool use: formato OpenAI (tool_calls / role:tool)
      type OpenAIMsg = Record<string, unknown>;
      const apiMessages: OpenAIMsg[] = [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      while (true) {
        const body: Record<string, unknown> = {
          model: bootstrap.model,
          max_tokens: maxTokens,
          messages: apiMessages,
          tools: TOOL_DEFINITIONS_OPENAI,
          tool_choice: "auto",
        };
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: openaiHeaders,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          throw new Error(`OpenAI API ${response.status}: ${errBody.slice(0, 200)}`);
        }
        const data = (await response.json()) as {
          choices: Array<{
            finish_reason: string;
            message: {
              role: string;
              content: string | null;
              tool_calls?: Array<{
                id: string;
                type: string;
                function: { name: string; arguments: string };
              }>;
            };
          }>;
        };

        const choice = data.choices[0];
        if (!choice) {
          throw new Error("OpenAI API: respuesta vacía");
        }

        if (choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) {
          return choice.message.content ?? "";
        }

        // Añadir turno del asistente con las tool_calls al historial
        apiMessages.push({ ...choice.message });

        // Ejecutar cada herramienta y añadir sus resultados
        for (const tc of choice.message.tool_calls) {
          const handler = TOOL_HANDLERS[tc.function.name];
          let resultContent: string;
          try {
            const input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            const toolResult = handler
              ? await handler(input)
              : { error: `Herramienta desconocida: ${tc.function.name}` };
            resultContent = JSON.stringify(toolResult);
          } catch (err) {
            resultContent = JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            });
          }
          apiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: resultContent,
          });
        }
      }
    }

    const openaiBody: Record<string, unknown> = {
      model: bootstrap.model,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    };
    if (!useReasoning) {
      // temperature: 0.3 solo para modelos estándar; o1/o3 no lo aceptan
      openaiBody.temperature = 0.3;
    }
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: openaiHeaders,
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
  bootstrap: BootstrapResult,
  systemPrompt: string,
  initialTrigger: string,
  modeConfig?: ModeConfig,
): Promise<StageOutcome> {
  const messages: Message[] = [{ role: "user", content: initialTrigger }];

  while (true) {
    // Llamar a la IA con el historial actual
    process.stdout.write("  (pensando...)\r");
    const aiText = await callAI(bootstrap, systemPrompt, messages, modeConfig);
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
  bootstrap: BootstrapResult,
  systemPrompt: string,
  initialTrigger: string,
  modeConfig?: ModeConfig,
): Promise<Message[]> {
  const messages: Message[] = [{ role: "user", content: initialTrigger }];

  while (true) {
    process.stdout.write("  (pensando...)\r");
    const aiText = await callAI(bootstrap, systemPrompt, messages, modeConfig);
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
    const raw = await callAI(bootstrap, extractionSystem, [
      ...conversationMessages,
      { role: "user", content: extractionRequest },
    ]);

    const result = attemptParse(raw);
    if (result !== null) return result;

    // Segundo intento con instrucción aún más explícita
    const raw2 = await callAI(bootstrap, extractionSystem, [
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
    if (result2 !== null) return result2;

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
  bootstrap: BootstrapResult,
  conversationMessages: Message[],
  currentData: ConversationData,
  scan: SystemScan,
): Promise<ConversationData> {
  const next = cloneConversationData(currentData);

  next.company = await extractJson<CompanyProfile>(
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

/**
 * Ejecuta la configuración conversacional completa: 7 etapas con la IA.
 * Navega hacia adelante con 'continuar'/'siguiente' y hacia atrás con 'atrás'/'volver'.
 * La única forma de salir es Ctrl+C.
 * Devuelve InstallerConfig con todos los datos recopilados.
 */
export async function runConversation(
  bootstrap: BootstrapResult,
  scan: SystemScan,
  mode: InstallMode = "adaptive",
): Promise<InstallerConfig> {
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

        const outcome = await runStage(rl, bootstrap, systemPrompt, trigger, modeConfig);

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
        data = await extractConversationData(bootstrap, allMessages, data, scan);
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
          : "Empieza confirmando el servidor o preguntando por el dato más importante que falte. Haz una sola pregunta cada vez. Cuando tengas toda la información necesaria para el plan, resume lo entendido y termina con [ETAPA_COMPLETA].";

      const messages = await runOpenConversation(rl, bootstrap, systemPrompt, trigger, modeConfig);
      allMessages.push(...messages);
      data = await extractConversationData(bootstrap, allMessages, data, scan);
    }

    rl.close();

    data = await extractConversationData(bootstrap, allMessages, data, scan);

    const config: InstallerConfig = {
      company: data.company,
      access: data.access,
      services: data.services,
      security: data.security,
      compliance: data.compliance,
      network: data.network,
      users: data.users,
      installMode: mode,
    };

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
