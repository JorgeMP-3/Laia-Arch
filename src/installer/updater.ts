// updater.ts — Actualización y mejoras del ecosistema LAIA
// runUpdater() es el punto de entrada que muestra el menú.

import { execSync } from "node:child_process";
import * as readline from "node:readline";
import { isCancel, select } from "@clack/prompts";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import { extractCredentialValue, retrieveProfileCredential } from "./credential-manager.js";
import { runBootstrap } from "./bootstrap.js";
import { TOOL_DEFINITIONS_ANTHROPIC, TOOL_DEFINITIONS_OPENAI, TOOL_HANDLERS } from "./tools/index.js";
import type { BootstrapResult } from "./types.js";

// ── Helpers internos ──────────────────────────────────────────────────────

function execSilent(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

function execVisible(cmd: string): void {
  execSync(cmd, { stdio: "inherit" });
}

async function askConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.on("SIGINT", () => {
      rl.close();
      process.exit(1);
    });
    rl.question(`  ${question} (s/n): `, (answer) => {
      rl.close();
      const n = answer.toLowerCase().trim();
      resolve(n === "s" || n === "si" || n === "sí" || n === "y" || n === "yes");
    });
  });
}

// ── Cliente IA mínimo (sin ModeConfig, sin stages) ────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

async function callUpdaterAI(
  bootstrap: BootstrapResult,
  systemPrompt: string,
  messages: ChatMessage[],
  useTools = false,
): Promise<string> {
  const key =
    bootstrap.providerId !== "ollama"
      ? extractCredentialValue(retrieveProfileCredential(bootstrap.profileId))
      : "";

  // ── Anthropic ──
  if (bootstrap.providerId === "anthropic") {
    const headers: Record<string, string> =
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

    if (useTools) {
      type ApiContent = Record<string, unknown>;
      type ApiMsg = { role: string; content: string | ApiContent[] };
      const apiMessages: ApiMsg[] = messages.map((m) => ({ role: m.role, content: m.content }));

      while (true) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: bootstrap.model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: apiMessages,
            tools: TOOL_DEFINITIONS_ANTHROPIC,
          }),
        });
        if (!response.ok) {
          const err = await response.text().catch(() => "");
          throw new Error(`Anthropic API ${response.status}: ${err.slice(0, 200)}`);
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
        const toolResults: ApiContent[] = [];
        for (const block of data.content.filter((b) => b.type === "tool_use")) {
          const handler = TOOL_HANDLERS[block.name ?? ""];
          let content: string;
          try {
            content = JSON.stringify(
              handler
                ? await handler((block.input ?? {}) as Record<string, unknown>)
                : { error: `Herramienta desconocida: ${block.name}` },
            );
          } catch (err) {
            content = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
          }
          toolResults.push({ type: "tool_result", tool_use_id: block.id ?? "", content });
        }
        apiMessages.push({ role: "assistant", content: data.content as ApiContent[] });
        apiMessages.push({ role: "user", content: toolResults });
      }
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: bootstrap.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages,
      }),
    });
    if (!response.ok) {
      const err = await response.text().catch(() => "");
      throw new Error(`Anthropic API ${response.status}: ${err.slice(0, 200)}`);
    }
    const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
    return data.content.find((b) => b.type === "text")?.text ?? "";
  }

  // ── OpenAI-compatible ──
  if (
    bootstrap.providerId === "openai" ||
    bootstrap.providerId === "openrouter" ||
    bootstrap.providerId === "openai-compatible" ||
    bootstrap.providerId === "deepseek"
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

    if (useTools && bootstrap.providerId !== "deepseek") {
      type OpenAIMsg = Record<string, unknown>;
      const apiMessages: OpenAIMsg[] = [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      while (true) {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: openaiHeaders,
          body: JSON.stringify({
            model: bootstrap.model,
            max_tokens: 4096,
            messages: apiMessages,
            tools: TOOL_DEFINITIONS_OPENAI,
            tool_choice: "auto",
          }),
        });
        if (!response.ok) {
          const err = await response.text().catch(() => "");
          throw new Error(`OpenAI API ${response.status}: ${err.slice(0, 200)}`);
        }
        const data = (await response.json()) as {
          choices: Array<{
            finish_reason: string;
            message: {
              role: string;
              content: string | null;
              tool_calls?: Array<{
                id: string;
                function: { name: string; arguments: string };
              }>;
            };
          }>;
        };
        const choice = data.choices[0];
        if (!choice) throw new Error("OpenAI API: respuesta vacía");
        if (choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) {
          return choice.message.content ?? "";
        }
        apiMessages.push({ ...choice.message });
        for (const tc of choice.message.tool_calls) {
          const handler = TOOL_HANDLERS[tc.function.name];
          let content: string;
          try {
            const input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            content = JSON.stringify(
              handler ? await handler(input) : { error: `Herramienta desconocida: ${tc.function.name}` },
            );
          } catch (err) {
            content = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
          }
          apiMessages.push({ role: "tool", tool_call_id: tc.id, content });
        }
      }
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: openaiHeaders,
      body: JSON.stringify({
        model: bootstrap.model,
        max_tokens: 2048,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        temperature: 0.3,
      }),
    });
    if (!response.ok) {
      const err = await response.text().catch(() => "");
      throw new Error(`OpenAI API ${response.status}: ${err.slice(0, 200)}`);
    }
    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
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
    if (!response.ok) throw new Error(`Ollama API ${response.status}`);
    const data = (await response.json()) as { message: { content: string } };
    return data.message?.content ?? "";
  }

  throw new Error(`Proveedor no soportado: ${bootstrap.providerId}`);
}

function printAiLine(text: string): void {
  console.log();
  const prefix = "  " + t.brand("Laia:") + " ";
  const indent = "         ";
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    process.stdout.write((i === 0 ? prefix : indent) + t.primary(lines[i]) + "\n");
  }
  console.log();
}

// ── runGenericUpdate ──────────────────────────────────────────────────────

export async function runGenericUpdate(): Promise<void> {
  console.log(t.section("ACTUALIZACIÓN DE LAIA ARCH"));

  const currentCommit = execSilent("git log --oneline -1");
  console.log(t.dim(`\n  Versión actual: ${currentCommit}\n`));

  console.log("  Verificando actualizaciones en origin/laia-arch-dev...");
  try {
    execSilent("git fetch origin laia-arch-dev");
  } catch {
    console.error(t.bad("  No se pudo conectar con el repositorio remoto."));
    return;
  }

  const pendingCommits = execSilent("git log HEAD..origin/laia-arch-dev --oneline");
  if (!pendingCommits) {
    console.log(t.good("\n  Ya tienes la versión más reciente. No hay actualizaciones disponibles.\n"));
    return;
  }

  console.log(t.step("\n  Actualizaciones disponibles:"));
  for (const line of pendingCommits.split("\n").filter(Boolean)) {
    console.log(`    ${t.muted(line)}`);
  }
  console.log();

  const ok = await askConfirm("¿Quieres instalar estas actualizaciones?");
  if (!ok) {
    console.log(t.dim("  Actualización cancelada.\n"));
    return;
  }

  console.log(t.step("\n  Descargando actualizaciones..."));
  execSilent("git pull origin laia-arch-dev");

  console.log(t.step("  Compilando nueva versión..."));
  try {
    execVisible("pnpm build:laia-arch");
  } catch {
    console.error(t.bad("  El build falló. Revisa los errores anteriores."));
    return;
  }

  const installedCommits = execSilent("git log HEAD~5..HEAD --oneline");
  console.log(t.step("\n  Commits instalados:"));
  for (const line of installedCommits.split("\n").filter(Boolean)) {
    console.log(`    ${t.muted(line)}`);
  }
  console.log(t.good("\n  Actualización completada.\n"));
}

// ── runOpenClawSync ───────────────────────────────────────────────────────

export async function runOpenClawSync(): Promise<void> {
  console.log(t.section("SINCRONIZACIÓN CON OPENCLAW UPSTREAM"));

  console.log("  Verificando cambios en origin/main...");
  execSilent("git fetch origin main");

  const pendingUpstream = execSilent("git log HEAD..origin/main --oneline");
  if (!pendingUpstream) {
    console.log(t.good("\n  No hay cambios nuevos en OpenClaw upstream.\n"));
    return;
  }

  const lines = pendingUpstream.split("\n").filter(Boolean);
  console.log(t.step(`\n  ${lines.length} commit(s) nuevos en OpenClaw upstream:`));
  for (const line of lines) {
    console.log(`    ${t.muted(line)}`);
  }
  console.log();
  console.log(
    t.warn(
      "  Esta operación puede requerir resolver conflictos manualmente.\n" +
        "  Los archivos de Laia Arch (src/installer/, install-prompts/) no deberían verse afectados.",
    ),
  );
  console.log();

  const ok = await askConfirm("¿Quieres integrar los cambios de OpenClaw upstream?");
  if (!ok) {
    console.log(t.dim("  Sincronización cancelada.\n"));
    return;
  }

  try {
    execSilent("git merge origin/main --no-edit");
    console.log(t.step("  Merge completado. Compilando..."));
    execVisible("pnpm build:laia-arch");
    console.log(t.good("  Sincronización con OpenClaw upstream completada.\n"));
  } catch {
    const conflicted = execSilent("git diff --name-only --diff-filter=U");
    console.error(t.bad("\n  El merge tiene conflictos. Archivos afectados:"));
    for (const f of conflicted.split("\n").filter(Boolean)) {
      console.log(`    ${t.muted(f)}`);
    }
    console.log(
      t.dim("\n  Resuelve los conflictos manualmente y ejecuta: git merge --continue\n"),
    );
  }
}

// ── runGuidedUpdate ───────────────────────────────────────────────────────

export async function runGuidedUpdate(bootstrap: BootstrapResult): Promise<void> {
  console.log(t.section("ACTUALIZACIÓN GUIADA CON IA"));

  execSilent("git fetch origin laia-arch-dev");

  const pendingCommits = execSilent("git log HEAD..origin/laia-arch-dev --oneline --format=%s");
  if (!pendingCommits) {
    console.log(t.good("\n  Ya tienes la versión más reciente. No hay nada que actualizar.\n"));
    return;
  }

  const systemPrompt =
    "Eres Laia Arch. Analiza estos cambios en el código y explica al administrador " +
    "en términos simples qué mejora, qué cambia y si hay algún riesgo. " +
    "Sé conciso. Al terminar pregunta si quiere proceder con la actualización.";

  const messages: ChatMessage[] = [
    {
      role: "user",
      content:
        "Hay actualizaciones disponibles. Estos son los cambios pendientes:\n\n" +
        pendingCommits
          .split("\n")
          .filter(Boolean)
          .map((l) => `- ${l}`)
          .join("\n"),
    },
  ];

  process.stdout.write("  (analizando cambios...)\r");
  const aiText = await callUpdaterAI(bootstrap, systemPrompt, messages);
  process.stdout.write("                         \r");
  printAiLine(aiText);

  const ok = await askConfirm("¿Quieres proceder con la actualización?");
  if (!ok) {
    console.log(t.dim("  Actualización cancelada.\n"));
    return;
  }

  await runGenericUpdate();
}

// ── runAiImprove ──────────────────────────────────────────────────────────

export async function runAiImprove(bootstrap: BootstrapResult): Promise<void> {
  console.log(t.section("MEJORAS CON IA — ECOSISTEMA LAIA"));

  // Detectar estado de servicios para el contexto
  let serviceStatusText = "";
  try {
    const { verifyServiceChain } = await import("./tools/verify-tools.js");
    const status = await verifyServiceChain();
    serviceStatusText = `\nEstado actual de servicios:\n${JSON.stringify(status, null, 2)}`;
  } catch {
    serviceStatusText = "\n(No se pudo obtener el estado de los servicios)";
  }

  const systemPrompt = [
    "Eres Laia Arch. El ecosistema LAIA está instalado en este servidor.",
    "Puedes ayudar al administrador a:",
    "- Añadir nuevos usuarios al sistema (LDAP + Samba + WireGuard si es remoto)",
    "- Configurar nuevos peers VPN para usuarios remotos",
    "- Mejorar la seguridad (LDAPS, HTTPS, reglas de firewall)",
    "- Añadir nuevas carpetas Samba con permisos por grupo",
    "- Configurar integraciones adicionales",
    "- Solucionar problemas detectados en los servicios",
    "",
    "Pregunta al administrador qué quiere mejorar.",
    "Usa get_system_info para verificar el estado actual antes de hacer cambios.",
    "Usa las tools disponibles para implementar directamente lo que se aprueba.",
    serviceStatusText,
  ]
    .filter(Boolean)
    .join("\n");

  console.log(t.dim('\n  Escribe "terminar" o pulsa Ctrl+C para salir.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  rl.on("SIGINT", () => {
    console.log("\n\n  Sesión de mejoras finalizada.");
    rl.close();
    process.exit(0);
  });

  const messages: ChatMessage[] = [
    { role: "user", content: "¿En qué puedes ayudarme hoy con el ecosistema LAIA?" },
  ];

  try {
    while (true) {
      process.stdout.write("  (pensando...)\r");
      const aiText = await callUpdaterAI(bootstrap, systemPrompt, messages, true);
      process.stdout.write("                \r");

      printAiLine(aiText);
      messages.push({ role: "assistant", content: aiText });

      const userInput = await new Promise<string>((resolve) => {
        rl.question("  " + t.brandDim("Tú:") + " ", resolve);
      });

      if (userInput.toLowerCase().trim() === "terminar") {
        console.log(t.dim("\n  Sesión de mejoras finalizada.\n"));
        rl.close();
        return;
      }

      messages.push({ role: "user", content: userInput });
    }
  } catch (err) {
    rl.close();
    throw err;
  }
}

// ── runUpdater ─────────────────────────────────────────────────────────────
// Punto de entrada del comando `laia-arch update`.

export async function runUpdater(): Promise<void> {
  console.log(t.banner?.() ?? "");

  const choice = await select({
    message: "¿Qué quieres hacer?",
    options: [
      {
        value: "generic",
        label: "Actualizar Laia Arch",
        hint: "Descarga e instala la versión más reciente del código",
      },
      {
        value: "openclaw",
        label: "Sincronizar con OpenClaw upstream",
        hint: "Integra los últimos cambios del proyecto base OpenClaw",
      },
      {
        value: "guided",
        label: "Actualización guiada con IA",
        hint: "La IA explica los cambios y guía la actualización",
      },
      {
        value: "improve",
        label: "Mejorar o ampliar con IA",
        hint: "Añade usuarios, servicios, mejora seguridad o soluciona problemas",
      },
    ],
  });

  if (isCancel(choice)) {
    console.log(t.dim("  Cancelado."));
    return;
  }

  if (choice === "generic") {
    await runGenericUpdate();
  } else if (choice === "openclaw") {
    await runOpenClawSync();
  } else {
    // Opciones que necesitan IA
    console.log(t.step("  Configurando proveedor de IA..."));
    const bootstrap = await runBootstrap();
    if (choice === "guided") {
      await runGuidedUpdate(bootstrap);
    } else {
      await runAiImprove(bootstrap);
    }
  }
}
