// executor.ts — Ejecución del plan de instalación paso a paso con HITL

import { execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import { extractCredentialValue, retrieveProfileCredential } from "./credential-manager.js";
import { requestApproval } from "./hitl-controller.js";
import type { BootstrapResult, InstallerConfig, InstallPlan, InstallStep } from "./types.js";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type ExecutionStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StepResult {
  stepId: string;
  status: ExecutionStatus;
  output?: string;
  error?: string;
}

/** Contexto de sudo para la sesión de instalación. */
interface SudoContext {
  /** Contraseña sudo. Cadena vacía si el sistema usa NOPASSWD. */
  password: string;
}

interface PersistedStepState {
  status: ExecutionStatus;
  ts: string;
  error?: string;
}

interface InstallProgressState {
  planSignature: string;
  steps: Record<string, PersistedStepState>;
}

export interface SudoersResult {
  ok: boolean;
  message: string;
}

// ── Ruta del archivo de estado ────────────────────────────────────────────────

const STATE_FILE = path.join(os.homedir(), ".laia-arch", "install-progress.json");
const DEFAULT_STEP_TIMEOUT_MS = 10 * 60_000;
const APT_INSTALL_TIMEOUT_MS = 15 * 60_000;
const HEAVY_INSTALL_TIMEOUT_MS = 30 * 60_000;
const HEARTBEAT_IDLE_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 1_000;
const HEAVY_PACKAGE_PATTERNS = [
  /\bslapd\b/,
  /\bdocker-ce(?:-cli)?\b/,
  /\bsamba\b/,
  /\bwireguard(?:-tools)?\b/,
  /\bnodejs\b/,
];
const LAIA_SUDOERS_FILE = "/etc/sudoers.d/laia-arch";
const LAIA_SUDOERS_CONTENT = `Defaults:laia-arch !requiretty

# Sistema base
laia-arch ALL=(root) NOPASSWD: /usr/bin/hostnamectl *
laia-arch ALL=(root) NOPASSWD: /usr/bin/apt-get update
laia-arch ALL=(root) NOPASSWD: /usr/bin/apt-get install *
laia-arch ALL=(root) NOPASSWD: /usr/bin/apt-get remove *
laia-arch ALL=(root) NOPASSWD: /usr/bin/apt-get purge *

# Systemd
laia-arch ALL=(root) NOPASSWD: /bin/systemctl start *
laia-arch ALL=(root) NOPASSWD: /bin/systemctl stop *
laia-arch ALL=(root) NOPASSWD: /bin/systemctl enable *
laia-arch ALL=(root) NOPASSWD: /bin/systemctl disable *
laia-arch ALL=(root) NOPASSWD: /bin/systemctl restart *
laia-arch ALL=(root) NOPASSWD: /bin/systemctl daemon-reload

# Red y kernel
laia-arch ALL=(root) NOPASSWD: /sbin/sysctl *
laia-arch ALL=(root) NOPASSWD: /usr/sbin/ufw *

# LDAP
laia-arch ALL=(root) NOPASSWD: /usr/bin/ldapadd *
laia-arch ALL=(root) NOPASSWD: /usr/bin/ldapmodify *
laia-arch ALL=(root) NOPASSWD: /usr/bin/ldappasswd *

# Samba
laia-arch ALL=(root) NOPASSWD: /usr/bin/smbpasswd *
laia-arch ALL=(root) NOPASSWD: /bin/mkdir *
laia-arch ALL=(root) NOPASSWD: /bin/chmod *
laia-arch ALL=(root) NOPASSWD: /bin/chown *

# WireGuard
laia-arch ALL=(root) NOPASSWD: /usr/bin/wg *
laia-arch ALL=(root) NOPASSWD: /usr/bin/wg-quick *

# Docker
laia-arch ALL=(root) NOPASSWD: /usr/bin/docker *

# Archivos y scripts
laia-arch ALL=(root) NOPASSWD: /usr/bin/tee *
laia-arch ALL=(root) NOPASSWD: /usr/bin/crontab *
laia-arch ALL=(root) NOPASSWD: /bin/chmod +x /usr/local/bin/*
laia-arch ALL=(root) NOPASSWD: /usr/bin/gpg *
laia-arch ALL=(root) NOPASSWD: /usr/bin/curl *
`;

function buildPlanSignature(plan: InstallPlan): string {
  const fingerprint = plan.steps.map((step) => ({
    id: step.id,
    phase: step.phase,
    description: step.description,
    commands: step.commands,
  }));
  return createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex");
}

function readProgressState(): InstallProgressState | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<InstallProgressState>;
    if (
      typeof raw.planSignature === "string" &&
      raw.steps !== undefined &&
      typeof raw.steps === "object" &&
      raw.steps !== null
    ) {
      return {
        planSignature: raw.planSignature,
        steps: raw.steps,
      };
    }
  } catch {
    // ignorar archivo ausente o corrupto
  }
  return undefined;
}

// ── Errores transitorios (candidatos a reintentar) ────────────────────────────

function isTransientError(message: string): boolean {
  return (
    message.includes("Could not get lock") || // dpkg/apt lock
    message.includes("dpkg lock") ||
    message.includes("ETIMEDOUT") ||
    message.includes("Could not connect") ||
    message.includes("temporary failure in name resolution") ||
    message.includes("Unable to connect") ||
    message.includes("Network is unreachable") ||
    message.includes("Connection timed out") ||
    /E: Could not fetch/.test(message) ||
    /Temporary failure/.test(message)
  );
}

// ── Comprobación de sudo sin contraseña ──────────────────────────────────────

export async function checkSudoPasswordless(): Promise<boolean> {
  try {
    execSync("sudo -n true", { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// ── Pedir contraseña ocultando caracteres ─────────────────────────────────────

export function askSudoPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    if (typeof process.stdin.setRawMode !== "function") {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    process.stdout.write(prompt);
    const wasRaw = process.stdin.isRaw ?? false;
    let password = "";
    let visibleChars = 0;

    const onData = (chunk: Buffer) => {
      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk[i];
        const c = String.fromCharCode(byte);

        if (c === "\r" || c === "\n") {
          process.stdin.setRawMode(wasRaw);
          process.stdin.removeListener("data", onData);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(password);
          return;
        } else if (c === "\u0003") {
          process.stdout.write("\n");
          process.exit(1);
        } else if (c === "\u0008" || c === "\u007f") {
          if (visibleChars > 0) {
            password = password.slice(0, -1);
            visibleChars--;
            process.stdout.write("\b \b");
          }
        } else if (byte >= 0x20) {
          password += c;
          visibleChars++;
          process.stdout.write("*");
        }
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

// ── Validar contraseña sudo ───────────────────────────────────────────────────

export async function validateSudoPassword(password: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("sudo", ["-S", "-p", "", "true"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    proc.stdin.write(`${password}\n`);
    proc.stdin.end();
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

export function buildLaiaSudoersContent(): string {
  return LAIA_SUDOERS_CONTENT;
}

export async function setupSudoers(password: string): Promise<SudoersResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };

  try {
    await execAsSudo(
      `cat <<'SUDOERS' > ${LAIA_SUDOERS_FILE}
${LAIA_SUDOERS_CONTENT}
SUDOERS
chmod 0440 ${LAIA_SUDOERS_FILE}`,
      password,
      env,
      30_000,
    );
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await execAsSudo(`visudo -c -f ${LAIA_SUDOERS_FILE}`, password, env, 30_000);
    return {
      ok: true,
      message: `Sudoers configurado y validado en ${LAIA_SUDOERS_FILE}.`,
    };
  } catch (err) {
    try {
      await execAsSudo(`rm -f ${LAIA_SUDOERS_FILE}`, password, env, 10_000);
    } catch {
      // Si la limpieza falla, el error principal sigue siendo el de validación.
    }

    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function revokeSudoers(password: string): Promise<SudoersResult> {
  try {
    await execAsSudo(`rm -f ${LAIA_SUDOERS_FILE}`, password, { ...process.env }, 10_000);
    return {
      ok: true,
      message: `Sudoers revocado en ${LAIA_SUDOERS_FILE}.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function isAptInstallCommand(cmd: string): boolean {
  return /\bapt(?:-get)?\b[^\n]*\binstall\b/.test(cmd.toLowerCase());
}

function hasHeavyPackages(cmd: string): boolean {
  const normalized = cmd.toLowerCase();
  return HEAVY_PACKAGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function resolveStepTimeoutMs(step: InstallStep): number {
  if (step.timeout !== undefined) {
    return step.timeout;
  }

  if (step.commands.some((cmd) => isAptInstallCommand(cmd) && hasHeavyPackages(cmd))) {
    return HEAVY_INSTALL_TIMEOUT_MS;
  }

  if (step.commands.some((cmd) => isAptInstallCommand(cmd))) {
    return APT_INSTALL_TIMEOUT_MS;
  }

  return DEFAULT_STEP_TIMEOUT_MS;
}

function clearHeartbeatLine(active: boolean): void {
  if (!active || !process.stdout.isTTY) {
    return;
  }
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
}

function renderCommandOutputLine(stream: "stdout" | "stderr", line: string): void {
  const writer = stream === "stdout" ? process.stdout : process.stderr;
  const prefix = stream === "stdout" ? t.muted("      │ ") : t.error("      ! ");
  const content = stream === "stdout" ? line : t.error(line);
  writer.write(`${prefix}${content}\n`);
}

function flushBufferedLines(
  stream: "stdout" | "stderr",
  buffer: string,
  flushRemainder: boolean,
): string {
  let lastIndex = 0;

  // Tratar `\r` como salto también permite ver progreso incremental de apt/dpkg.
  for (const match of buffer.matchAll(/\r\n|\n|\r/g)) {
    const index = match.index ?? 0;
    renderCommandOutputLine(stream, buffer.slice(lastIndex, index));
    lastIndex = index + match[0].length;
  }

  const remainder = buffer.slice(lastIndex);
  if (flushRemainder && remainder.length > 0) {
    renderCommandOutputLine(stream, remainder);
    return "";
  }

  return remainder;
}

async function execWithStreaming(
  spawnCmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  input?: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(spawnCmd, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const startedAt = Date.now();
    let lastOutputAt = startedAt;
    let heartbeatVisible = false;

    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(heartbeatTimer);
      clearHeartbeatLine(heartbeatVisible);
      heartbeatVisible = false;
    };

    const noteOutput = () => {
      lastOutputAt = Date.now();
      clearHeartbeatLine(heartbeatVisible);
      heartbeatVisible = false;
    };

    const handleChunk = (stream: "stdout" | "stderr", chunk: Buffer) => {
      noteOutput();
      const text = chunk.toString();
      if (stream === "stdout") {
        stdout += text;
        stdoutBuffer += text;
        stdoutBuffer = flushBufferedLines("stdout", stdoutBuffer, false);
      } else {
        stderr += text;
        stderrBuffer += text;
        stderrBuffer = flushBufferedLines("stderr", stderrBuffer, false);
      }
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      proc.kill("SIGKILL");
      reject(
        new Error(
          `Timeout (${Math.round(timeoutMs / 60_000)} min): ${args.at(-1)?.slice(0, 80) ?? spawnCmd}`,
        ),
      );
    }, timeoutMs);

    const heartbeatTimer = setInterval(() => {
      if (settled || Date.now() - lastOutputAt < HEARTBEAT_IDLE_MS || !process.stdout.isTTY) {
        return;
      }
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(
        t.muted(
          `      … proceso activo, sin salida nueva desde hace ${formatElapsed(Date.now() - lastOutputAt)} (total ${formatElapsed(Date.now() - startedAt)})`,
        ),
      );
      heartbeatVisible = true;
    }, HEARTBEAT_INTERVAL_MS);

    if (input !== undefined) {
      proc.stdin.write(input);
    }
    proc.stdin.end();

    proc.stdout.on("data", (chunk: Buffer) => {
      handleChunk("stdout", chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      handleChunk("stderr", chunk);
    });

    proc.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      stdoutBuffer = flushBufferedLines("stdout", stdoutBuffer, true);
      stderrBuffer = flushBufferedLines("stderr", stderrBuffer, true);

      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const errLines = stderr.trim().split("\n");
        const errSummary = errLines.slice(-20).join("\n");
        reject(new Error(`Exit ${code}: ${errSummary || stdout.trim().slice(-500)}`));
      }
    });

    proc.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(err);
    });
  });
}

// ── Ejecutar comando como root vía sudo ──────────────────────────────────────

/**
 * Ejecuta un comando de shell bajo sudo, pasando la contraseña por stdin.
 * Usa `sudo -S bash -c '...'` para que los operadores de shell (>>, |, etc.)
 * funcionen correctamente bajo el contexto de root.
 * La contraseña nunca aparece en la línea de comandos ni en /proc.
 */
async function execAsSudo(
  cmd: string,
  password: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return execWithStreaming(
    "sudo",
    ["-S", "-p", "", "bash", "-c", cmd],
    env,
    timeoutMs,
    `${password}\n`,
  );
}

// ── Ejecutar comando sin sudo (para comandos de usuario) ─────────────────────

async function execAsUser(
  cmd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return execWithStreaming("bash", ["-c", cmd], env, timeoutMs);
}

// ── Keep-alive del sudo ───────────────────────────────────────────────────────

/**
 * Renueva la sesión sudo cada 90 s para evitar que expire durante
 * instalaciones largas (el timeout por defecto de sudo es 5 min = 300 s).
 */
function startSudoKeepAlive(password: string): NodeJS.Timeout {
  return setInterval(() => {
    const proc = spawn("sudo", ["-S", "-p", "", "-v"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    proc.stdin.write(`${password}\n`);
    proc.stdin.end();
    proc.on("error", () => {
      /* silencioso */
    });
  }, 90_000);
}

// ── Persistencia del estado ───────────────────────────────────────────────────

function saveStepStateForPlan(
  planSignature: string,
  stepId: string,
  status: ExecutionStatus,
  error?: string,
): void {
  try {
    const state = readProgressState();
    const nextState: InstallProgressState =
      state?.planSignature === planSignature ? state : { planSignature, steps: {} };

    nextState.steps[stepId] = {
      status,
      ts: new Date().toISOString(),
      ...(error ? { error } : {}),
    };

    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2), { mode: 0o600 });
  } catch {
    /* no bloquear la instalación por fallos de escritura */
  }
}

function loadCompletedSteps(planSignature: string): Set<string> {
  const state = readProgressState();
  if (state?.planSignature !== planSignature) {
    return new Set();
  }
  return new Set(
    Object.entries(state.steps)
      .filter(([, value]) => value.status === "done")
      .map(([stepId]) => stepId),
  );
}

function clearStepState(): void {
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    /* ya no existía */
  }
}

// ── Modo rescate ──────────────────────────────────────────────────────────────

interface RescueContext {
  step: InstallStep;
  output: string;
  error?: string;
  completedCount: number;
  totalCount: number;
  planSummary: string;
  /** Ruta al log de instalación para que la IA pueda leerlo. */
  logPath?: string;
  /** Configuración completa de la instalación. */
  installerConfig?: InstallerConfig;
  /** Resumen del sistema (de last-scan.json). */
  systemInfo?: string;
}

type RescueDecision = "continue" | "cancel";

function buildPlanSummary(plan: InstallPlan, completedStepIds: Set<string>): string {
  return plan.steps
    .map((s) => {
      const status = completedStepIds.has(s.id) ? "✓" : "○";
      return `  ${status} [${s.id}] ${s.description}`;
    })
    .join("\n");
}

async function callRescueAI(
  bootstrap: BootstrapResult,
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const key =
    bootstrap.providerId !== "ollama"
      ? extractCredentialValue(retrieveProfileCredential(bootstrap.profileId))
      : "";

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
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    return data.content.find((b) => b.type === "text")?.text ?? "";
  }

  // OpenAI-compatible providers (openai, deepseek, openrouter, openai-compatible, ollama)
  const baseUrl =
    bootstrap.baseUrl ??
    (bootstrap.providerId === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : bootstrap.providerId === "deepseek"
        ? "https://api.deepseek.com/v1"
        : bootstrap.providerId === "ollama"
          ? "http://localhost:11434/v1"
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
    throw new Error(`AI API ${response.status}: ${body.slice(0, 200)}`);
  }
  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? "";
}

/** Devuelve comandos de diagnóstico sugeridos según el tipo de error y el paso. */
function buildErrorDiagnosticHints(error: string, step: InstallStep): string {
  const errorLower = error.toLowerCase();
  const stepId = step.id.toLowerCase();
  if (stepId.includes("ldap") || errorLower.includes("ldap") || errorLower.includes("slapd")) {
    return [
      "- Estado slapd  : journalctl -u slapd -n 50",
      "- Config slapd  : slapcat -n 0",
      "- Test conexión : ldapsearch -x -H ldap://localhost -b '' -s base",
      "- Logs syslog   : tail -50 /var/log/syslog | grep -i slapd",
    ].join("\n");
  }
  if (stepId.includes("dns") || errorLower.includes("named") || errorLower.includes("bind")) {
    return [
      "- Estado named  : systemctl status named",
      "- Verificar cfg : named-checkconf",
      "- Test DNS      : dig @localhost localhost",
      "- Logs named    : journalctl -u named -n 50",
    ].join("\n");
  }
  if (stepId.includes("docker") || errorLower.includes("docker")) {
    return [
      "- Info docker   : docker info",
      "- Contenedores  : docker ps -a",
      "- Logs docker   : journalctl -u docker -n 50",
      "- Estado servicio: systemctl status docker",
    ].join("\n");
  }
  if (stepId.includes("wg") || errorLower.includes("wireguard")) {
    return [
      "- Interfaces    : ip link show",
      "- Config WG     : wg show",
      "- Logs wg       : journalctl -u wg-quick@wg0 -n 50",
    ].join("\n");
  }
  if (stepId.includes("smb") || errorLower.includes("samba") || errorLower.includes("smbd")) {
    return [
      "- Estado samba  : systemctl status smbd nmbd",
      "- Verificar cfg : testparm",
      "- Logs smbd     : journalctl -u smbd -n 50",
    ].join("\n");
  }
  return [
    "- Logs recientes : journalctl -n 100 --no-pager",
    "- Fallos unitarios: systemctl list-units --state=failed",
    "- Espacio disco  : df -h",
    "- Red activa     : ip addr && ss -tlnp",
  ].join("\n");
}

function buildRescueSystemPrompt(ctx: RescueContext): string {
  const configSection = ctx.installerConfig
    ? `\nCONFIGURACIÓN DE LA INSTALACIÓN:\n` +
      `- Empresa  : ${ctx.installerConfig.company.name} (sector: ${ctx.installerConfig.company.sector})\n` +
      `- Dominio  : ${ctx.installerConfig.network?.internalDomain ?? "(no configurado)"}\n` +
      `- Usuarios : ${ctx.installerConfig.users?.map((u) => u.username).join(", ") ?? "ninguno"}\n` +
      `- Servicios: ${
        Object.entries(ctx.installerConfig.services)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(", ")
      }`
    : "";

  const logSection = ctx.logPath
    ? `\nLOG DE INSTALACIÓN:\nPuedes leer el log completo con read_file en: ${ctx.logPath}`
    : "";

  const systemSection = ctx.systemInfo
    ? `\nINFORMACIÓN DEL SISTEMA:\n${ctx.systemInfo}`
    : "";

  const errorHints = buildErrorDiagnosticHints(ctx.error ?? "", ctx.step);

  return `Eres una IA de diagnóstico y recuperación para el instalador de Laia Arch.

CONTEXTO ACTUAL:
- Paso: ${ctx.step.id} — ${ctx.step.description}
- Fase: ${ctx.step.phase}
- Pasos completados: ${ctx.completedCount} de ${ctx.totalCount}
- Error: ${ctx.error ?? "(ninguno — el administrador activó el rescate manualmente)"}

COMANDOS DEL PASO:
${ctx.step.commands.map((c) => `  $ ${c}`).join("\n")}

ÚLTIMAS LÍNEAS DE SALIDA:
${ctx.output ? ctx.output.split("\n").slice(-30).join("\n") : "(sin salida)"}

PLAN RESUMIDO:
${ctx.planSummary}${configSection}${logSection}${systemSection}

HERRAMIENTAS DISPONIBLES:
Tienes acceso a las tools del instalador: check_service_status, read_file, install_package
y otras. Úsalas directamente para diagnosticar y resolver el problema.
NO pidas al administrador que copie y pegue comandos — ejecútalos tú con las tools.

DIAGNÓSTICO SUGERIDO PARA ESTE TIPO DE ERROR:
${errorHints}

TU OBJETIVO:
1. Diagnosticar el problema con las tools disponibles.
2. Ejecutar las soluciones directamente — no esperes a que el administrador las ejecute.
3. Cuando el problema esté resuelto, comunícalo y pide que escriba "continuar".
4. Si la instalación debe abortarse, pide que escriba "cancelar".

Responde siempre en español. Sé claro, directo y técnico.`;
}

async function runRescueMode(ctx: RescueContext, bootstrap: BootstrapResult): Promise<RescueDecision> {
  console.log(`\n${"═".repeat(62)}`);
  console.log(t.warn("  MODO RESCATE ACTIVADO"));
  console.log(`${"═".repeat(62)}\n`);
  console.log(t.muted('  Escribe "continuar" para reanudar la instalación.'));
  console.log(t.muted('  Escribe "cancelar" para abortar la instalación.\n'));

  const systemPrompt = buildRescueSystemPrompt(ctx);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Primer mensaje: pide diagnóstico inicial
  const initialMessage = ctx.error
    ? `Ha ocurrido un error durante la instalación:\n\n${ctx.error}\n\n¿Qué ha pasado y cómo puedo solucionarlo?`
    : `He activado el modo rescate antes del paso ${ctx.step.id}. ¿Puedes explicarme qué va a hacer este paso y qué debo saber antes de aprobarlo?`;

  messages.push({ role: "user", content: initialMessage });

  try {
    process.stdout.write(t.muted("  Analizando..."));
    const response = await callRescueAI(bootstrap, systemPrompt, messages);
    process.stdout.write("\r  \r");
    console.log(`\n  ${t.brand("🔧 IA Rescate:")}\n`);
    for (const line of response.split("\n")) {
      console.log(`  ${line}`);
    }
    messages.push({ role: "assistant", content: response });
  } catch (err) {
    process.stdout.write("\r  \r");
    console.log(
      t.error(`  Error al contactar la IA: ${err instanceof Error ? err.message : String(err)}`),
    );
    console.log(t.muted('  Escribe "continuar" para seguir o "cancelar" para abortar.'));
  }

  // Bucle de conversación libre
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  try {
    while (true) {
      const input = await new Promise<string>((resolve) => {
        rl.question(`\n  ${t.label("Tú")} > `, resolve);
      });

      const norm = input.toLowerCase().trim();

      if (norm === "continuar" || norm === "continue") {
        console.log(`\n  ${t.good("Reanudando instalación...")}\n`);
        return "continue";
      }
      if (norm === "cancelar" || norm === "cancel") {
        console.log(`\n  ${t.warn("Instalación cancelada desde el modo rescate.")}\n`);
        return "cancel";
      }
      if (!input.trim()) continue;

      messages.push({ role: "user", content: input });
      try {
        process.stdout.write(t.muted("  Pensando..."));
        const response = await callRescueAI(bootstrap, systemPrompt, messages);
        process.stdout.write("\r  \r");
        console.log(`\n  ${t.brand("🔧 IA Rescate:")}\n`);
        for (const line of response.split("\n")) {
          console.log(`  ${line}`);
        }
        messages.push({ role: "assistant", content: response });
      } catch (err) {
        process.stdout.write("\r  \r");
        console.log(
          t.error(`  Error: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    }
  } finally {
    rl.close();
  }
}

/** Pregunta aprobación con soporte para palabras clave de rescate. */
async function askApprovalWithRescue(
  request: ApprovalRequestLocal,
): Promise<"approved" | "rejected" | "timeout" | "rescue"> {
  const ACCEPT = new Set(["s", "si", "sí", "y", "yes", "ok", "adelante", "aprobado"]);
  const REJECT = new Set(["n", "no", "rechazar", "cancelar"]);
  const RESCUE = new Set(["rescate", "ayuda", "help", "rescue"]);

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    let settled = false;
    const settle = (result: "approved" | "rejected" | "timeout" | "rescue") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      resolve(result);
    };

    const timer = setTimeout(() => {
      console.log(`\n  Tiempo de espera agotado (${request.timeoutSeconds}s). Paso rechazado.`);
      settle("timeout");
    }, request.timeoutSeconds * 1000);

    rl.question(
      `  ¿Aprobar este paso? (s/n/rescate) [timeout ${request.timeoutSeconds}s]: `,
      (answer) => {
        const norm = answer.toLowerCase().trim();
        if (ACCEPT.has(norm)) {
          settle("approved");
        } else if (REJECT.has(norm)) {
          settle("rejected");
        } else if (RESCUE.has(norm)) {
          settle("rescue");
        } else {
          console.log(
            '  Responde "s" para aprobar, "n" para rechazar o "rescate" para pedir ayuda.',
          );
          settle("rejected");
        }
      },
    );
  });
}

// Tipo mínimo que necesita askApprovalWithRescue — evita importar ApprovalRequest completo
interface ApprovalRequestLocal {
  timeoutSeconds: number;
}

async function askConfirmationInline(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question(`  ${question} (s/n): `, (answer) => {
      rl.close();
      const norm = answer.toLowerCase().trim();
      resolve(norm === "s" || norm === "si" || norm === "sí");
    });
  });
}

// ── Ejecutar un solo paso ─────────────────────────────────────────────────────

/**
 * Ejecuta un único paso del plan.
 * - Cuando hay sudoContext, todos los comandos corren bajo `sudo bash -c '...'`
 *   (necesario para que >> y | funcionen correctamente como root).
 * - Reintenta ante errores transitorios (apt lock, red caída, etc.).
 */
export async function executeStep(
  step: InstallStep,
  sudoContext?: SudoContext,
): Promise<StepResult> {
  const result: StepResult = { stepId: step.id, status: "running" };
  const outputs: string[] = [];
  const env: NodeJS.ProcessEnv = { ...process.env, DEBIAN_FRONTEND: "noninteractive" };
  const timeoutMs = resolveStepTimeoutMs(step);
  const maxRetries = step.maxRetries ?? 2;

  try {
    for (const cmd of step.commands) {
      console.log(`    $ ${cmd}`);

      let stdout = "";
      let _stderr = "";

      // Reintentar ante errores transitorios
      let lastErr: Error | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (sudoContext !== undefined) {
            ({ stdout, stderr: _stderr } = await execAsSudo(
              cmd,
              sudoContext.password,
              env,
              timeoutMs,
            ));
          } else {
            ({ stdout, stderr: _stderr } = await execAsUser(cmd, env, timeoutMs));
          }
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          const canRetry = isTransientError(lastErr.message) && attempt < maxRetries;
          if (!canRetry) {
            break;
          }
          const delaySec = (attempt + 1) * 5;
          console.log(
            `    ${t.warn(`↻ Error transitorio — reintentando en ${delaySec}s (intento ${attempt + 1}/${maxRetries})`)}`,
          );
          await new Promise((r) => setTimeout(r, delaySec * 1000));
        }
      }

      if (lastErr) {
        throw lastErr;
      }

      const out = stdout.trim();
      if (out) {
        outputs.push(out);
      }
    }

    result.status = "done";
    result.output = outputs.join("\n");
  } catch (err) {
    result.status = "failed";
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`\n  ${t.error(`ERROR en paso ${step.id}:`)}`);
    console.error(`  ${result.error}`);

    if (step.rollback) {
      console.log(`\n  Ejecutando rollback: ${step.rollback}`);
      try {
        if (sudoContext !== undefined) {
          await execAsSudo(step.rollback, sudoContext.password, env, 120_000);
        } else {
          await execAsUser(step.rollback, env, 120_000);
        }
        console.log("  Rollback completado.");
      } catch (rbErr) {
        console.error("  Rollback falló:", rbErr instanceof Error ? rbErr.message : String(rbErr));
      }
    }
  }

  return result;
}

// ── Ejecutar el plan completo ─────────────────────────────────────────────────

/**
 * Ejecuta el plan completo paso a paso.
 * - Pide la contraseña sudo si es necesario (hasta 3 intentos).
 * - Mantiene la sesión sudo activa durante toda la instalación.
 * - Persiste el estado de cada paso para poder retomar si se interrumpe.
 * - Ofrece reanudar desde el último paso fallido si se detecta progreso previo.
 * - Los pasos con requiresApproval=true esperan confirmación antes de ejecutarse.
 */
export async function executePlan(
  plan: InstallPlan,
  options?: { bootstrap?: BootstrapResult },
): Promise<StepResult[]> {
  const bootstrap = options?.bootstrap;
  const results: StepResult[] = [];
  const planSignature = buildPlanSignature(plan);
  const previousState = readProgressState();

  // ── 1. Resolver acceso sudo ───────────────────────────────────────────────

  const passwordless = await checkSudoPasswordless();
  let sudoCtx: SudoContext | undefined;

  if (passwordless) {
    // NOPASSWD o root: sudo funciona sin contraseña
    sudoCtx = { password: "" };
    console.log(`\n  ${t.good("✓ Acceso sudo sin contraseña disponible.")}\n`);
  } else {
    console.log(`\n  ${t.warn("⚠ sudo requiere contraseña en este sistema.")}`);
    console.log(
      `  ${t.muted("El instalador necesita privilegios de administrador para continuar.")}\n`,
    );

    let validated = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const prompt =
        attempt === 1
          ? `  Contraseña sudo para ${process.env["USER"] ?? "root"}: `
          : `  Contraseña incorrecta, intento ${attempt}/3: `;

      const candidate = await askSudoPassword(prompt);
      if (!candidate) {
        console.log(`\n  ${t.warn("Contraseña vacía — omitida.")}`);
        break;
      }

      process.stdout.write(`  ${t.muted("Verificando...")}`);
      const ok = await validateSudoPassword(candidate);
      process.stdout.write("\r  \r");

      if (ok) {
        sudoCtx = { password: candidate };
        validated = true;
        console.log(`  ${t.good("✓ Contraseña sudo verificada.")}\n`);
        break;
      }
    }

    if (!validated) {
      console.log(`\n  ${t.warn("⚠ No se pudo verificar la contraseña sudo.")}`);
      console.log(
        `  ${t.muted("Los comandos del sistema fallarán. Para evitarlo ejecuta primero:")}\n`,
      );
      console.log(`  ${t.brand("sudo bash scripts/setup-sudoers.sh")}\n`);

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      const answer = await new Promise<string>((resolve) => {
        rl.question("  ¿Continuar de todas formas? (s/n): ", resolve);
      });
      rl.close();

      if (!["s", "si", "sí"].includes(answer.toLowerCase().trim())) {
        process.exit(0);
      }
      // sudoCtx queda undefined → los comandos corren sin sudo
    }
  }

  // ── 2. Comprobar si hay una instalación previa que retomar ────────────────

  if (previousState !== undefined && previousState.planSignature !== planSignature) {
    console.log(
      `\n  ${t.muted("Se ha ignorado un estado de instalación anterior porque pertenece a otro plan.")}`,
    );
    clearStepState();
  }

  const completedSteps = loadCompletedSteps(planSignature);
  if (completedSteps.size > 0) {
    console.log(
      `\n  ${t.warn(`⚠ Instalación previa detectada: ${completedSteps.size} pasos ya completados.`)}`,
    );

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const answer = await new Promise<string>((resolve) => {
      rl.question(
        `  ¿Reanudar desde donde se dejó? (s = reanudar, n = empezar de cero): `,
        resolve,
      );
    });
    rl.close();

    if (!["s", "si", "sí"].includes(answer.toLowerCase().trim())) {
      clearStepState();
      completedSteps.clear();
      console.log(`  ${t.muted("Empezando desde el principio.\n")}`);
    } else {
      console.log(`  ${t.good("Reanudando instalación.\n")}`);
    }
  }

  // ── 3. Iniciar keep-alive del sudo ────────────────────────────────────────

  let keepAliveTimer: NodeJS.Timeout | undefined;
  if (sudoCtx) {
    keepAliveTimer = startSudoKeepAlive(sudoCtx.password);
  }

  // ── 4. Cabecera ───────────────────────────────────────────────────────────

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║            EJECUTANDO PLAN DE INSTALACIÓN               ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`  Pasos totales   : ${plan.steps.length}`);
  console.log(`  Tiempo estimado : ~${plan.estimatedMinutes} minutos\n`);

  // ── 5. Bucle de pasos ─────────────────────────────────────────────────────

  try {
    for (const step of plan.steps) {
      // Saltar pasos ya completados al reanudar
      if (completedSteps.has(step.id)) {
        console.log(`\n  ⏭  [${step.id}] ${step.description} ${t.muted("(reanudado — omitido)")}`);
        results.push({ stepId: step.id, status: "done" });
        continue;
      }

      console.log(`\n  ▶ [${step.id}] ${step.description}`);

      if (step.requiresApproval) {
        const request = await requestApproval(step, 120);
        let approvalDecision = await askApprovalWithRescue(request);

        if (approvalDecision === "rescue") {
          if (bootstrap) {
            const ctx: RescueContext = {
              step,
              output: "",
              completedCount: completedSteps.size,
              totalCount: plan.steps.length,
              planSummary: buildPlanSummary(plan, completedSteps),
            };
            const rescueResult = await runRescueMode(ctx, bootstrap);
            // "continue" → proceder con el paso; "cancel" → detener
            approvalDecision = rescueResult === "continue" ? "approved" : "rejected";
          } else {
            console.log(t.muted("  Modo rescate no disponible (proveedor IA no configurado)."));
            approvalDecision = "rejected";
          }
        }

        if (approvalDecision === "rejected") {
          console.log(`\n  Paso ${step.id} rechazado. Deteniendo ejecución.`);
          const r: StepResult = {
            stepId: step.id,
            status: "skipped",
            error: "rechazado por el usuario",
          };
          results.push(r);
          saveStepStateForPlan(planSignature, step.id, "skipped", r.error);
          break;
        }
        if (approvalDecision === "timeout") {
          console.log(`\n  Paso ${step.id} ignorado por timeout. Deteniendo ejecución.`);
          const r: StepResult = {
            stepId: step.id,
            status: "skipped",
            error: "timeout de aprobación",
          };
          results.push(r);
          saveStepStateForPlan(planSignature, step.id, "skipped", r.error);
          break;
        }
      }

      const result = await executeStep(step, sudoCtx);
      results.push(result);
      saveStepStateForPlan(planSignature, result.stepId, result.status, result.error);

      if (result.status === "failed") {
        if (bootstrap) {
          const activateRescue = await askConfirmationInline(
            "¿Activar el modo rescate para diagnosticar el error?",
          );
          if (activateRescue) {
            const ctx: RescueContext = {
              step,
              output: result.output ?? "",
              error: result.error,
              completedCount: completedSteps.size,
              totalCount: plan.steps.length,
              planSummary: buildPlanSummary(plan, completedSteps),
            };
            await runRescueMode(ctx, bootstrap);
          }
        }
        console.error(`\n  El paso ${step.id} ha fallado. Deteniendo ejecución.`);
        console.log(
          `  ${t.muted("Vuelve a ejecutar 'laia-arch install' para retomar desde aquí.")}`,
        );
        break;
      }

      console.log(`  ✓ Paso ${step.id} completado.`);
    }
  } finally {
    if (keepAliveTimer !== undefined) {
      clearInterval(keepAliveTimer);
    }
  }

  // ── 6. Resumen ────────────────────────────────────────────────────────────

  const done = results.filter((r) => r.status === "done").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  console.log(
    `\n  Resultado: ${done} completados, ${failed} fallidos, ${skipped} omitidos de ${plan.steps.length} pasos.`,
  );

  // Si todo fue bien, limpiar el archivo de estado
  if (failed === 0 && skipped === 0 && done === plan.steps.length) {
    clearStepState();
  }

  return results;
}
