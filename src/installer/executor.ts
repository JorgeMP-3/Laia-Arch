// executor.ts — Ejecución del plan de instalación paso a paso con HITL

import { execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { upsertAuthProfile } from "../agents/auth-profiles/profiles.js";
import type { AuthProfileCredential } from "../agents/auth-profiles/types.js";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import {
  buildActionProposalsFromPlan,
  buildConversationIntent,
  createInstallSessionState,
} from "./agentic.js";
import {
  extractCredentialValue,
  retrieveCredential,
  retrieveProfileCredential,
  storeCredential,
} from "./credential-manager.js";
import { requestApproval } from "./hitl-controller.js";
import {
  TOOL_DEFINITIONS_ANTHROPIC,
  TOOL_DEFINITIONS_OPENAI,
  TOOL_HANDLERS,
} from "./tools/index.js";
import { checkServiceStatus } from "./tools/system-tools.js";
import { runBackupTest, verifyDnsResolution, verifyServiceChain } from "./tools/verify-tools.js";
import type {
  ActionExecution,
  ActionProposal,
  BootstrapResult,
  ConversationIntent,
  InstallSessionState,
  InstallerConfig,
  InstallationGoal,
  InstallationSnapshot,
  InstallPlan,
  InstallStep,
  RepairAttempt,
  SystemScan,
  VerificationCheckResult,
  VerificationReport,
  VerificationRequirement,
} from "./types.js";
import { runGenericUninstall } from "./uninstaller.js";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type ExecutionStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StepResult {
  stepId: string;
  status: ExecutionStatus;
  output?: string;
  error?: string;
  verification?: VerificationReport;
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

type ResumeDecision = "resume" | "restart" | "clean-restart";

type PreservedInstallSecrets = {
  generatedCredentials: Array<{ id: string; value: string }>;
  bootstrapProfile?: { profileId: string; credential: AuthProfileCredential };
};

type InstallSecretDeps = {
  readGeneratedCredential: (id: string) => Promise<string>;
  writeGeneratedCredential: (id: string, value: string) => Promise<void>;
  readBootstrapProfile: (profileId: string) => AuthProfileCredential;
  writeBootstrapProfile: (profileId: string, credential: AuthProfileCredential) => void;
};

export interface SudoersResult {
  ok: boolean;
  message: string;
}

// ── Ruta del archivo de estado ────────────────────────────────────────────────

const STATE_FILE = path.join(os.homedir(), ".laia-arch", "install-progress.json");
const SESSION_FILE = path.join(os.homedir(), ".laia-arch", "install-session.json");
const INSTALLER_CONFIG_FILE = path.join(os.homedir(), ".laia-arch", "installer-config.json");
const INSTALLER_INTENT_FILE = path.join(os.homedir(), ".laia-arch", "installer-intent.json");
const LAST_SCAN_FILE = path.join(os.homedir(), ".laia-arch", "last-scan.json");
const INSTALL_LOGS_DIR = path.join(os.homedir(), ".laia-arch", "logs");
const DEFAULT_RESCUE_LOG_PATH = path.join(INSTALL_LOGS_DIR, "install-latest.log");
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

const DEFAULT_INSTALL_SECRET_DEPS: InstallSecretDeps = {
  readGeneratedCredential: retrieveCredential,
  writeGeneratedCredential: async (id, value) => {
    await storeCredential(id, "password", value);
  },
  readBootstrapProfile: retrieveProfileCredential,
  writeBootstrapProfile: (profileId, credential) => {
    upsertAuthProfile({ profileId, credential });
  },
};

function buildPlanSignature(plan: InstallPlan): string {
  const fingerprint = plan.steps.map((step) => ({
    id: step.id,
    phase: step.phase,
    description: step.description,
    commands: step.commands,
  }));
  return createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex");
}

function resolveProposalStepId(proposal: ActionProposal): string {
  return proposal.sourceStepId ?? proposal.id;
}

function proposalToInstallStep(proposal: ActionProposal): InstallStep {
  return {
    id: resolveProposalStepId(proposal),
    phase: proposal.phase,
    description: proposal.description,
    commands: proposal.commands,
    requiresApproval: proposal.requiresApproval,
    rollback: proposal.rollback,
    timeout: proposal.timeout,
    maxRetries: proposal.maxRetries,
  };
}

function buildFallbackPlanFromProposals(proposals: ActionProposal[]): InstallPlan {
  return {
    steps: proposals.map((proposal) => proposalToInstallStep(proposal)),
    estimatedMinutes: Math.max(5, proposals.length * 2),
    warnings: [],
    requiredCredentials: [],
  };
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

function readInstallSessionState(): InstallSessionState | undefined {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")) as InstallSessionState;
  } catch {
    return undefined;
  }
}

function writeInstallSessionState(state: InstallSessionState): void {
  try {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch {
    /* no bloquear */
  }
}

function clearInstallSessionState(): void {
  try {
    fs.unlinkSync(SESSION_FILE);
  } catch {
    /* ya no existía */
  }
}

export function parseResumeDecision(answer: string): ResumeDecision {
  const normalized = answer.trim().toLowerCase();
  if (["d", "desinstalar", "limpiar", "borrar"].includes(normalized)) {
    return "clean-restart";
  }
  if (["s", "si", "sí", "resume", "reanudar"].includes(normalized)) {
    return "resume";
  }
  return "restart";
}

export async function captureInstallSecrets(
  plan: InstallPlan,
  bootstrap?: BootstrapResult,
  deps: InstallSecretDeps = DEFAULT_INSTALL_SECRET_DEPS,
): Promise<PreservedInstallSecrets> {
  const generatedCredentials: Array<{ id: string; value: string }> = [];

  for (const credentialId of plan.requiredCredentials) {
    try {
      generatedCredentials.push({
        id: credentialId,
        value: await deps.readGeneratedCredential(credentialId),
      });
    } catch {
      // Si aún no existe alguna credencial, no bloqueamos el flujo.
    }
  }

  let bootstrapProfile: PreservedInstallSecrets["bootstrapProfile"];
  if (bootstrap?.profileId) {
    try {
      bootstrapProfile = {
        profileId: bootstrap.profileId,
        credential: deps.readBootstrapProfile(bootstrap.profileId),
      };
    } catch {
      // El bootstrap puede no requerir restauración si aún no había perfil persistido.
    }
  }

  return { generatedCredentials, bootstrapProfile };
}

export async function restoreInstallSecrets(
  snapshot: PreservedInstallSecrets,
  deps: InstallSecretDeps = DEFAULT_INSTALL_SECRET_DEPS,
): Promise<void> {
  for (const credential of snapshot.generatedCredentials) {
    await deps.writeGeneratedCredential(credential.id, credential.value);
  }

  if (snapshot.bootstrapProfile) {
    deps.writeBootstrapProfile(
      snapshot.bootstrapProfile.profileId,
      snapshot.bootstrapProfile.credential,
    );
  }
}

function loadInstallerIntentForExecution(scan?: SystemScan): ConversationIntent | undefined {
  try {
    return JSON.parse(fs.readFileSync(INSTALLER_INTENT_FILE, "utf8")) as ConversationIntent;
  } catch {
    try {
      const config = JSON.parse(fs.readFileSync(INSTALLER_CONFIG_FILE, "utf8")) as InstallerConfig;
      return buildConversationIntent(config, config.installMode ?? "adaptive", [], scan);
    } catch {
      return undefined;
    }
  }
}

function buildInstallationSnapshot(
  planSignature: string,
  scan: SystemScan | undefined,
): InstallationSnapshot {
  const watchedServices = [
    "bind9",
    "slapd",
    "smbd",
    "nmbd",
    "wg-quick@wg0",
    "docker",
    "nginx",
    "cockpit.socket",
  ];
  const observedServices: InstallationSnapshot["observedServices"] = {};
  for (const service of watchedServices) {
    const status = checkServiceStatus(service);
    observedServices[service] = status.success ? status.status : "unknown";
  }

  const chain = verifyServiceChain();
  let gateway = {
    url: "http://127.0.0.1:18789/healthz",
    reachable: false,
    healthzOk: false,
  };
  try {
    execSync("curl -fsS http://127.0.0.1:18789/healthz >/dev/null", {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 5000,
    });
    gateway = {
      url: "http://127.0.0.1:18789/healthz",
      reachable: true,
      healthzOk: true,
    };
  } catch {
    gateway = {
      url: "http://127.0.0.1:18789/healthz",
      reachable: false,
      healthzOk: false,
    };
  }

  return {
    timestamp: new Date().toISOString(),
    planSignature,
    scan,
    observedServices,
    serviceChain: chain.success ? chain : undefined,
    gateway,
    warnings: scan?.warnings ?? [],
  };
}

function upsertExecution(state: InstallSessionState, execution: ActionExecution): void {
  const current = state.executions[execution.proposalId] ?? [];
  current.push(execution);
  state.executions[execution.proposalId] = current;
}

function upsertRepair(state: InstallSessionState, repair: RepairAttempt): void {
  const current = state.repairs[repair.proposalId] ?? [];
  current.push(repair);
  state.repairs[repair.proposalId] = current;
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
  logPath: string;
  /** Configuración completa de la instalación. */
  installerConfig: InstallerConfig;
  /** Resumen del sistema (de last-scan.json). */
  systemInfo: string;
  /** ConversationIntent original resumido para el rescate. */
  intentContext: string;
  /** Historial estructurado de ejecuciones previas de la sesión. */
  executionHistory: string;
  /** Historial estructurado de reparaciones previas de la sesión. */
  repairHistory: string;
}

type RescueDecision = "continue" | "cancel";

interface RescueOperationalMemory {
  intentContext: string;
  executionHistory: string;
  repairHistory: string;
}

function buildPlanSummary(plan: InstallPlan, completedStepIds: Set<string>): string {
  return plan.steps
    .map((s) => {
      const status = completedStepIds.has(s.id) ? "✓" : "○";
      return `  ${status} [${s.id}] ${s.description}`;
    })
    .join("\n");
}

function truncateTextForPrompt(value: string | undefined, maxLines = 6, maxChars = 400): string {
  if (!value?.trim()) {
    return "(sin salida)";
  }
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-maxLines)
    .join(" | ");
  return lines.length > maxChars ? `${lines.slice(0, maxChars)}…` : lines;
}

function summarizeVerificationForRescue(verification?: VerificationReport): string {
  if (!verification) {
    return "sin verificación";
  }
  if (verification.success) {
    return `OK — ${verification.checks.map((check) => check.requirement.kind).join(", ")}`;
  }
  const failingChecks = verification.checks
    .filter((check) => !check.success)
    .map(
      (check) =>
        `${check.requirement.kind}: ${truncateTextForPrompt(check.details ?? check.requirement.description, 2, 160)}`,
    );
  return `FAIL — ${failingChecks.join(" | ") || verification.summary}`;
}

function buildIntentContextForRescue(intent: ConversationIntent | undefined): string {
  if (!intent) {
    return "(no se encontró ConversationIntent persistido para esta sesión)";
  }

  const desiredUsers =
    intent.goal.desiredUsers.length > 0
      ? intent.goal.desiredUsers
          .map((user) => `${user.username} (${user.role}${user.remote ? ", remoto" : ""})`)
          .join(", ")
      : "ninguno";
  const pendingGaps =
    intent.pendingGaps.length > 0
      ? intent.pendingGaps
          .map((gap) => `${gap.key}${gap.blocking ? " [bloqueante]" : ""}: ${gap.description}`)
          .join(" | ")
      : "ninguno";
  const contradictions =
    intent.contradictions.length > 0
      ? intent.contradictions
          .map(
            (item) =>
              `${item.key}: ${truncateTextForPrompt(item.firstStatement, 1, 100)} -> ${truncateTextForPrompt(item.laterStatement, 1, 100)}${item.resolution ? ` | resuelto: ${truncateTextForPrompt(item.resolution, 1, 100)}` : ""}`,
          )
          .join(" | ")
      : "ninguna";

  return [
    `- Resumen original: ${intent.summary}`,
    `- Objetivo: host=${intent.goal.targetHostname} dominio=${intent.goal.targetDomain}`,
    `- Servicios deseados: ${intent.goal.desiredServices.join(", ") || "ninguno"}`,
    `- Usuarios deseados: ${desiredUsers}`,
    `- Decisiones: ${intent.decisions.join(" | ") || "ninguna"}`,
    `- Huecos pendientes: ${pendingGaps}`,
    `- Contradicciones: ${contradictions}`,
  ].join("\n");
}

function buildExecutionHistoryForRescue(session: InstallSessionState): string {
  const proposalById = new Map(session.proposals.map((proposal) => [proposal.id, proposal]));
  const proposalOrder = new Map(session.proposals.map((proposal, index) => [proposal.id, index]));
  const executionEntries = Object.entries(session.executions).toSorted(
    ([left], [right]) =>
      (proposalOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (proposalOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
  );

  if (executionEntries.length === 0) {
    return "(sin ejecuciones previas en esta sesión)";
  }

  return executionEntries
    .map(([proposalId, executions]) => {
      const proposal = proposalById.get(proposalId);
      const header = `- [${proposal?.sourceStepId ?? proposalId}] ${proposal?.title ?? "(sin título)"}`;
      const attempts = executions
        .map((execution) => {
          const verificationSummary = summarizeVerificationForRescue(execution.verification);
          const errorSummary = execution.error
            ? ` error=${truncateTextForPrompt(execution.error, 2, 180)}`
            : "";
          return `  intento ${execution.attempt}: status=${execution.status}${errorSummary} | salida=${truncateTextForPrompt(execution.output)} | verificación=${verificationSummary}`;
        })
        .join("\n");
      return `${header}\n${attempts}`;
    })
    .join("\n");
}

function buildRepairHistoryForRescue(session: InstallSessionState): string {
  const proposalById = new Map(session.proposals.map((proposal) => [proposal.id, proposal]));
  const proposalOrder = new Map(session.proposals.map((proposal, index) => [proposal.id, index]));
  const repairEntries = Object.entries(session.repairs)
    .toSorted(
      ([left], [right]) =>
        (proposalOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (proposalOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
    )
    .flatMap(([proposalId, repairs]) =>
      repairs.map((repair) => ({
        proposalId,
        repair,
        proposal: proposalById.get(proposalId),
      })),
    );

  if (repairEntries.length === 0) {
    return "(sin reparaciones previas en esta sesión)";
  }

  return repairEntries
    .map(({ proposalId, repair, proposal }) => {
      const stepLabel = proposal?.sourceStepId ?? proposalId;
      const title = proposal?.title ?? "(sin título)";
      const error = repair.error ? ` | error=${truncateTextForPrompt(repair.error, 2, 180)}` : "";
      return `- [${stepLabel}] ${title} | intento=${repair.attempt} | estrategia=${repair.strategy} | estado=${repair.status} | notas=${truncateTextForPrompt(repair.notes, 2, 180)}${error}`;
    })
    .join("\n");
}

export function buildRescueOperationalMemory(
  session: InstallSessionState,
): RescueOperationalMemory {
  return {
    intentContext: buildIntentContextForRescue(session.intent),
    executionHistory: buildExecutionHistoryForRescue(session),
    repairHistory: buildRepairHistoryForRescue(session),
  };
}

function createRescueContext(params: {
  session: InstallSessionState;
  plan: InstallPlan;
  completedStepIds: Set<string>;
  step: InstallStep;
  output: string;
  error?: string;
  logPath: string;
  installerConfig: InstallerConfig;
  systemInfo: string;
}): RescueContext {
  const operationalMemory = buildRescueOperationalMemory(params.session);
  return {
    step: params.step,
    output: params.output,
    error: params.error,
    completedCount: params.completedStepIds.size,
    totalCount: params.plan.steps.length,
    planSummary: buildPlanSummary(params.plan, params.completedStepIds),
    logPath: params.logPath,
    installerConfig: params.installerConfig,
    systemInfo: params.systemInfo,
    intentContext: operationalMemory.intentContext,
    executionHistory: operationalMemory.executionHistory,
    repairHistory: operationalMemory.repairHistory,
  };
}

function createFallbackInstallerConfig(): InstallerConfig {
  return {
    company: {
      name: "(desconocida)",
      sector: "(desconocido)",
      teamSize: 0,
      language: "es",
      timezone: "UTC",
    },
    access: {
      totalUsers: 0,
      roles: [],
      remoteUsers: 0,
      devices: [],
      needsVpn: false,
      needsMfa: false,
    },
    services: {
      dns: false,
      ldap: false,
      samba: false,
      wireguard: false,
      docker: false,
      nginx: false,
      cockpit: false,
      backups: false,
    },
    security: {
      passwordComplexity: "medium",
      diskEncryption: false,
      internetExposed: false,
      sshKeyOnly: false,
    },
    compliance: {
      gdpr: false,
      backupRetentionDays: 0,
      dataTypes: [],
      jurisdiction: "(desconocida)",
    },
  };
}

function loadInstallerConfigForRescue(): InstallerConfig {
  try {
    const raw = fs.readFileSync(INSTALLER_CONFIG_FILE, "utf8");
    return JSON.parse(raw) as InstallerConfig;
  } catch {
    return createFallbackInstallerConfig();
  }
}

function loadSystemInfoForRescue(): string {
  try {
    const raw = fs.readFileSync(LAST_SCAN_FILE, "utf8");
    const parsed = JSON.parse(raw) as { timestamp?: string; scan?: SystemScan };
    const scan = parsed.scan;
    if (!scan) {
      throw new Error("scan ausente");
    }
    return [
      `- Hostname     : ${scan.os.hostname}`,
      `- Sistema      : ${scan.os.distribution} ${scan.os.version} (${scan.os.kernel})`,
      `- Red          : ${scan.network.localIp} / gw ${scan.network.gateway}`,
      `- DNS          : ${scan.network.dns}`,
      `- Hardware     : ${scan.hardware.cores} cores, ${scan.hardware.ramGb} GB RAM`,
      `- Servicios    : ${scan.services.join(", ") || "(ninguno detectado)"}`,
      `- Puertos      : ${scan.ports.join(", ") || "(ninguno detectado)"}`,
      `- Avisos scan  : ${scan.warnings.join(" | ") || "(sin avisos)"}`,
    ].join("\n");
  } catch {
    return `No se pudo leer ${LAST_SCAN_FILE}.`;
  }
}

function resolveRescueLogPath(): string {
  try {
    const newest = fs
      .readdirSync(INSTALL_LOGS_DIR)
      .filter((entry) => /^install-.*\.log$/.test(entry))
      .map((entry) => path.join(INSTALL_LOGS_DIR, entry))
      .toSorted((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
    return newest ?? DEFAULT_RESCUE_LOG_PATH;
  } catch {
    return DEFAULT_RESCUE_LOG_PATH;
  }
}

type RescueAnthropicTextBlock = { type: "text"; text: string };
type RescueAnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type RescueAnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
};
type RescueAnthropicContentBlock =
  | RescueAnthropicTextBlock
  | RescueAnthropicToolUseBlock
  | RescueAnthropicToolResultBlock;
type RescueAnthropicMessage = {
  role: "user" | "assistant";
  content: string | RescueAnthropicContentBlock[];
};

type RescueOpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};
type RescueOpenAISystemOrUserMessage = {
  role: "system" | "user";
  content: string;
};
type RescueOpenAIAssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: RescueOpenAIToolCall[];
};
type RescueOpenAIToolMessage = {
  role: "tool";
  content: string;
  tool_call_id: string;
};
type RescueOpenAIMessage =
  | RescueOpenAISystemOrUserMessage
  | RescueOpenAIAssistantMessage
  | RescueOpenAIToolMessage;

type RescueAIResult =
  | {
      kind: "text";
      text: string;
      assistantMessage: RescueAnthropicMessage | RescueOpenAIAssistantMessage;
    }
  | {
      kind: "anthropic_tool_use";
      assistantMessage: RescueAnthropicMessage;
      toolUses: RescueAnthropicToolUseBlock[];
    }
  | {
      kind: "openai_tool_calls";
      assistantMessage: RescueOpenAIAssistantMessage;
      toolCalls: RescueOpenAIToolCall[];
    };

function isAnthropicToolUseBlock(
  block: RescueAnthropicContentBlock,
): block is RescueAnthropicToolUseBlock {
  return block.type === "tool_use";
}

function isAnthropicTextBlock(
  block: RescueAnthropicContentBlock,
): block is RescueAnthropicTextBlock {
  return block.type === "text";
}

/**
 * Tools que modifican el sistema de forma significativa y requieren aprobación explícita.
 * restart_service y enable_service no están aquí — son operaciones seguras y reversibles.
 */
const RESCUE_TOOLS_REQUIRING_APPROVAL = new Set([
  "install_package",
  "repair_dpkg",
  "write_file",
  "run_command",
  "configure_ufw",
  "configure_sysctl",
  "add_apt_repository",
]);

async function executeRescueTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (RESCUE_TOOLS_REQUIRING_APPROVAL.has(name)) {
    const inputPreview = JSON.stringify(input, null, 2)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n");
    console.log(`\n  ${t.warn(`⚠ La IA quiere ejecutar: ${name}`)}`);
    console.log(inputPreview);
    const approved = await askConfirmationInline("¿Aprobar esta acción?");
    if (!approved) {
      return JSON.stringify({
        success: false,
        error: "Acción rechazada por el administrador.",
        retryable: true,
      });
    }
  }
  console.log(`\n  ${t.muted(`Ejecutando tool: ${name}...`)}`);
  const handler = TOOL_HANDLERS[name];
  try {
    const toolResult = handler
      ? await handler(input)
      : { error: `Herramienta desconocida: ${name}` };
    return JSON.stringify(toolResult);
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function parseOpenAIToolArguments(argumentsJson: string): Record<string, unknown> {
  if (!argumentsJson.trim()) {
    return {};
  }
  const parsed = JSON.parse(argumentsJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Los argumentos de la tool deben ser un objeto JSON.");
  }
  return parsed as Record<string, unknown>;
}

function printRescueAssistantReply(response: string): void {
  console.log(`\n  ${t.brand("🔧 IA Rescate:")}\n`);
  for (const line of response.split("\n")) {
    console.log(`  ${line}`);
  }
}

function printRescueToolResult(resultJson: string): void {
  const MAX = 300;
  const display = resultJson.length > MAX ? `${resultJson.slice(0, MAX)}…` : resultJson;
  console.log(`  ${t.muted(`↳ ${display}`)}`);
}

/** Muestra cuenta atrás en consola y espera `seconds` segundos. */
async function waitWithCountdown(seconds: number, label: string): Promise<void> {
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(`\r  ${t.muted(`${label} ${i}s...`)}  `);
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write("\r  \r");
}

async function callRescueAI(
  bootstrap: BootstrapResult,
  systemPrompt: string,
  messages: RescueAnthropicMessage[] | RescueOpenAIMessage[],
): Promise<RescueAIResult> {
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

    let response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: bootstrap.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages,
        tools: TOOL_DEFINITIONS_ANTHROPIC,
      }),
    });

    // Retry automático en rate limit (429)
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("retry-after") ?? "60", 10);
      const waitSecs = Math.min(Math.max(retryAfter, 15), 120);
      console.log(
        `\n  ${t.warn(`⏳ Límite de tokens alcanzado. Reintentando en ${waitSecs}s...`)}`,
      );
      await waitWithCountdown(waitSecs, "Reintentando en");
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: bootstrap.model,
          max_tokens: 2048,
          system: systemPrompt,
          messages,
          tools: TOOL_DEFINITIONS_ANTHROPIC,
        }),
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = (await response.json()) as {
      stop_reason?: string | null;
      content: RescueAnthropicContentBlock[];
    };
    const assistantMessage: RescueAnthropicMessage = {
      role: "assistant",
      content: data.content,
    };
    const toolUses = data.content.filter(isAnthropicToolUseBlock);
    if (data.stop_reason === "tool_use" && toolUses.length > 0) {
      return {
        kind: "anthropic_tool_use",
        assistantMessage,
        toolUses,
      };
    }
    const text = data.content
      .filter(isAnthropicTextBlock)
      .map((block) => block.text)
      .join("\n");
    return {
      kind: "text",
      text,
      assistantMessage,
    };
  }

  const baseUrl =
    bootstrap.baseUrl ??
    (bootstrap.providerId === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : bootstrap.providerId === "deepseek"
        ? "https://api.deepseek.com/v1"
        : bootstrap.providerId === "ollama"
          ? "http://localhost:11434/v1"
          : "https://api.openai.com/v1");

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key || "none"}`,
  };
  const requestBody = {
    model: bootstrap.model,
    max_tokens: 2048,
    messages,
    tools: TOOL_DEFINITIONS_OPENAI,
    tool_choice: "auto" as const,
  };

  let response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok && bootstrap.providerId === "ollama") {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: bootstrap.model,
        max_tokens: 2048,
        messages,
      }),
    });
  }

  // Retry automático en rate limit (429)
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("retry-after") ?? "60", 10);
    const waitSecs = Math.min(Math.max(retryAfter, 15), 120);
    console.log(`\n  ${t.warn(`⏳ Límite de tokens alcanzado. Reintentando en ${waitSecs}s...`)}`);
    await waitWithCountdown(waitSecs, "Reintentando en");
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`AI API ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{
      finish_reason: string;
      message: {
        role: string;
        content: string | null;
        tool_calls?: RescueOpenAIToolCall[];
      };
    }>;
  };
  const choice = data.choices[0];
  if (!choice) {
    throw new Error("AI API: respuesta vacía");
  }
  const assistantMessage: RescueOpenAIAssistantMessage = {
    role: "assistant",
    content: choice.message.content,
    tool_calls: choice.message.tool_calls,
  };
  const toolCalls = choice.message.tool_calls ?? [];
  if (toolCalls.length > 0) {
    return {
      kind: "openai_tool_calls",
      assistantMessage,
      toolCalls,
    };
  }
  return {
    kind: "text",
    text: choice.message.content ?? "",
    assistantMessage,
  };
}

async function resolveAnthropicRescueTurn(
  bootstrap: BootstrapResult,
  systemPrompt: string,
  messages: RescueAnthropicMessage[],
): Promise<string> {
  while (true) {
    const result = await callRescueAI(bootstrap, systemPrompt, messages);
    if (result.kind === "anthropic_tool_use") {
      messages.push(result.assistantMessage);
      // Mostrar texto de razonamiento que la IA produce antes de llamar a las tools
      const textBlocks = Array.isArray(result.assistantMessage.content)
        ? result.assistantMessage.content.filter(isAnthropicTextBlock)
        : [];
      if (textBlocks.length > 0) {
        process.stdout.write("\r  \r");
        printRescueAssistantReply(textBlocks.map((b) => b.text).join("\n"));
      }
      const toolResults: RescueAnthropicToolResultBlock[] = [];
      for (const toolUse of result.toolUses) {
        const resultContent = await executeRescueTool(toolUse.name, toolUse.input);
        printRescueToolResult(resultContent);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: resultContent,
        });
      }
      messages.push({ role: "user", content: toolResults });
      process.stdout.write(t.muted("  Analizando..."));
      continue;
    }
    if (result.kind === "text") {
      messages.push(result.assistantMessage as RescueAnthropicMessage);
      return result.text;
    }
    throw new Error("La respuesta del proveedor no coincide con el formato Anthropic.");
  }
}

async function resolveOpenAIRescueTurn(
  bootstrap: BootstrapResult,
  systemPrompt: string,
  messages: RescueOpenAIMessage[],
): Promise<string> {
  while (true) {
    const result = await callRescueAI(bootstrap, systemPrompt, messages);
    if (result.kind === "openai_tool_calls") {
      messages.push(result.assistantMessage);
      // Mostrar texto de razonamiento que la IA produce antes de llamar a las tools
      const preText = result.assistantMessage.content;
      if (preText && preText.trim()) {
        process.stdout.write("\r  \r");
        printRescueAssistantReply(preText);
      }
      for (const toolCall of result.toolCalls) {
        let resultContent: string;
        try {
          resultContent = await executeRescueTool(
            toolCall.function.name,
            parseOpenAIToolArguments(toolCall.function.arguments),
          );
        } catch (err) {
          resultContent = JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
        printRescueToolResult(resultContent);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: resultContent,
        });
      }
      process.stdout.write(t.muted("  Analizando..."));
      continue;
    }
    if (result.kind === "text") {
      messages.push(result.assistantMessage as RescueOpenAIAssistantMessage);
      return result.text;
    }
    throw new Error("La respuesta del proveedor no coincide con el formato OpenAI.");
  }
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
      "PRIMER PASO OBLIGATORIO: llama a read_logs('named') para ver el error exacto de bind9.",
      "- Logs named    : read_logs({ service: 'named', lines: 80 })",
      "- Verificar cfg : leer /etc/bind/named.conf.local con read_file para detectar zonas duplicadas",
      "- Estado named  : check_service_status({ service: 'named' })",
      "ATENCIÓN: las zonas duplicadas en named.conf.local son un error frecuente en re-instalaciones.",
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
  if (
    stepId.includes("net") ||
    errorLower.includes("network") ||
    errorLower.includes("ufw") ||
    errorLower.includes("port") ||
    errorLower.includes("socket")
  ) {
    return [
      "- Interfaces    : ip addr",
      "- Puertos       : ss -tlnp",
      "- Firewall      : ufw status verbose",
      "- Rutas         : ip route",
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

function summarizeSystemInfoForRescue(raw: string): string {
  try {
    const scan = JSON.parse(raw) as {
      os?: unknown;
      network?: unknown;
      hardware?: { diskFreeGb?: number };
    };
    return JSON.stringify(
      { os: scan.os, network: scan.network, diskFreeGb: scan.hardware?.diskFreeGb },
      null,
      2,
    );
  } catch {
    return raw.slice(0, 500);
  }
}

function buildRescueSystemPrompt(ctx: RescueContext): string {
  const enabledServices =
    Object.entries(ctx.installerConfig.services)
      .filter(([, enabled]) => enabled)
      .map(([service]) => service)
      .join(", ") || "ninguno";
  const configuredUsers =
    ctx.installerConfig.users?.map((user) => `${user.username} (${user.role})`).join(", ") ??
    "ninguno";
  const errorHints = buildErrorDiagnosticHints(ctx.error ?? "", ctx.step);

  return `Eres Laia Arch en modo de diagnostico y recuperacion.
No eres otro agente distinto: sigues la misma instalacion con mas contexto y mas libertad para diagnosticar.

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
${ctx.planSummary}

CONFIGURACIÓN DE LA INSTALACIÓN:
- Empresa   : ${ctx.installerConfig.company.name} (sector: ${ctx.installerConfig.company.sector})
- Dominio   : ${ctx.installerConfig.network?.internalDomain ?? "(no configurado)"}
- Usuarios  : ${configuredUsers}
- Servicios : ${enabledServices}

CONVERSATIONINTENT ORIGINAL:
${ctx.intentContext}

HISTORIAL DE EJECUCIÓN DE ESTA SESIÓN:
${ctx.executionHistory}

HISTORIAL DE REPARACIONES DE ESTA SESIÓN:
${ctx.repairHistory}

LOG DE INSTALACIÓN:
Puedes leer el log completo con la tool read_file en la ruta: ${ctx.logPath}

INFORMACIÓN DEL SISTEMA:
${summarizeSystemInfoForRescue(ctx.systemInfo)}

HERRAMIENTAS DISPONIBLES:
Tienes acceso completo a las tools del instalador para diagnosticar y reparar:

Diagnóstico (sin aprobación — úsalas libremente):
- read_logs — journalctl de un servicio. EMPIEZA SIEMPRE POR AQUÍ cuando un servicio falla.
- run_diagnostic — cualquier comando de solo lectura: named-checkconf, grep, cat, dpkg -l, ss, ip...
- read_file — leer archivos en /etc/ o /srv/
- get_system_info — estado del hardware, OS y red
- check_service_status — estado de un servicio systemd
- check_internet — conectividad a internet

Reparación (requiere aprobación del administrador — se mostrará ⚠ y pedirá s/n):
- repair_dpkg — repara dpkg inconsistente: dpkg --configure -a + apt-get -f install + autoremove
- install_package — instala paquetes con apt-get
- restart_service — reinicia un servicio systemd (systemctl restart)
- enable_service — activa e inicia un servicio (systemctl enable + start)
- write_file — escribe o sobreescribe un archivo en /etc/ o /srv/
- run_command — ejecuta cualquier comando con sudo (usa esto cuando las otras tools no lleguen)

NUNCA pidas al administrador que copie y pegue comandos — ejecútalos tú directamente con estas tools.
Si necesitas editar un archivo del sistema, usa write_file o run_command, no le pidas al usuario que lo haga.

DIAGNÓSTICO SUGERIDO PARA ESTE TIPO DE ERROR:
${errorHints}

TU OBJETIVO:
1. Diagnosticar el problema con las tools disponibles.
2. Ejecutar las comprobaciones o acciones correctivas directamente con las tools disponibles.
3. Explicar brevemente que observaste, que hiciste y que resultado obtuviste.
4. Cuando el problema esté resuelto, comunícalo y pide que escriba "continuar".
5. Si la instalación debe abortarse, pide que escriba "cancelar".

Responde siempre en español. Sé claro, directo y técnico.`;
}

async function runRescueMode(
  ctx: RescueContext,
  bootstrap: BootstrapResult,
): Promise<RescueDecision> {
  console.log(`\n${"═".repeat(62)}`);
  console.log(t.warn("  MODO RESCATE ACTIVADO"));
  console.log(`${"═".repeat(62)}\n`);
  console.log(t.muted('  Escribe "continuar" para reanudar la instalación.'));
  console.log(t.muted('  Escribe "cancelar" para abortar la instalación.\n'));

  const systemPrompt = buildRescueSystemPrompt(ctx);
  const anthropicMessages: RescueAnthropicMessage[] = [];
  const openAiMessages: RescueOpenAIMessage[] = [{ role: "system", content: systemPrompt }];
  const isAnthropicProvider = bootstrap.providerId === "anthropic";

  // Primer mensaje: pide diagnóstico inicial
  const initialMessage = ctx.error
    ? `Ha ocurrido un error durante la instalación:\n\n${ctx.error}\n\n¿Qué ha pasado y cómo puedo solucionarlo?`
    : `He activado el modo rescate antes del paso ${ctx.step.id}. ¿Puedes explicarme qué va a hacer este paso y qué debo saber antes de aprobarlo?`;

  anthropicMessages.push({ role: "user", content: initialMessage });
  openAiMessages.push({ role: "user", content: initialMessage });

  try {
    process.stdout.write(t.muted("  Analizando..."));
    const response = isAnthropicProvider
      ? await resolveAnthropicRescueTurn(bootstrap, systemPrompt, anthropicMessages)
      : await resolveOpenAIRescueTurn(bootstrap, systemPrompt, openAiMessages);
    process.stdout.write("\r  \r");
    printRescueAssistantReply(response);
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
      if (!input.trim()) {
        continue;
      }

      anthropicMessages.push({ role: "user", content: input });
      openAiMessages.push({ role: "user", content: input });
      try {
        process.stdout.write(t.muted("  Pensando..."));
        const response = isAnthropicProvider
          ? await resolveAnthropicRescueTurn(bootstrap, systemPrompt, anthropicMessages)
          : await resolveOpenAIRescueTurn(bootstrap, systemPrompt, openAiMessages);
        process.stdout.write("\r  \r");
        printRescueAssistantReply(response);
      } catch (err) {
        process.stdout.write("\r  \r");
        console.log(t.error(`  Error: ${err instanceof Error ? err.message : String(err)}`));
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
      if (settled) {
        return;
      }
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

function createVerificationReport(
  proposalId: string,
  checks: VerificationCheckResult[],
): VerificationReport {
  const success = checks.every((check) => check.success);
  return {
    proposalId,
    success,
    retryable: checks.some((check) => !check.success),
    summary: success
      ? "All verification checks passed."
      : checks
          .filter((check) => !check.success)
          .map((check) => check.details ?? check.requirement.description)
          .join(" | "),
    checks,
    observedState: Object.fromEntries(
      checks.map((check) => [
        check.requirement.kind,
        check.details ?? (check.success ? "ok" : "failed"),
      ]),
    ),
  };
}

function checkPackageInstalled(packageName: string): { success: boolean; details: string } {
  try {
    const status = execSync("dpkg-query -W -f='${Status}' " + JSON.stringify(packageName), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: "/bin/bash",
    })
      .trim()
      .toLowerCase();
    const installed = status.includes("install ok installed");
    return {
      success: installed,
      details: installed ? `package ${packageName} installed` : `package ${packageName} missing`,
    };
  } catch (error) {
    return {
      success: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

function verifyHostnameConfigured(
  expectedHostname: string | undefined,
  expectedFqdn: string | undefined,
): { success: boolean; details: string } {
  try {
    const hostname =
      execSync("hostnamectl --static 2>/dev/null || hostname", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: "/bin/bash",
      })
        .trim()
        .toLowerCase() || os.hostname().trim().toLowerCase();
    const hostsFile = fs.readFileSync("/etc/hosts", "utf8");
    const hostnameOk = expectedHostname
      ? hostname === expectedHostname.toLowerCase()
      : hostname.length > 0;
    const fqdnOk = expectedFqdn ? hostsFile.includes(expectedFqdn) : true;
    return {
      success: hostnameOk && fqdnOk,
      details: `hostname=${hostname} fqdnInHosts=${fqdnOk}`,
    };
  } catch (error) {
    return {
      success: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export function verifySingleRequirement(
  requirement: VerificationRequirement,
): VerificationCheckResult {
  switch (requirement.kind) {
    case "service-active": {
      const service = requirement.service ?? "";
      const status = checkServiceStatus(service);
      return {
        requirement,
        success: status.success && status.status === "active",
        details: status.success ? `service ${service}: ${status.status}` : status.error,
      };
    }
    case "dns-resolution": {
      const hostname = requirement.hostname ?? "localhost";
      const result = verifyDnsResolution(hostname);
      return {
        requirement,
        success: result.success && result.resolves,
        details: result.success
          ? result.resolves
            ? `resolved ${hostname} -> ${result.ip ?? "(no IP)"}`
            : `${hostname} did not resolve`
          : result.error,
      };
    }
    case "hostname-configured": {
      const result = verifyHostnameConfigured(requirement.hostname, requirement.expectedValue);
      return {
        requirement,
        success: result.success,
        details: result.details,
      };
    }
    case "ldap-bind": {
      const chain = verifyServiceChain();
      return {
        requirement,
        success: chain.success && chain.ldap && chain.ldap_responds,
        details: chain.success
          ? `ldap active=${chain.ldap} responds=${chain.ldap_responds}`
          : chain.error,
      };
    }
    case "package-installed": {
      const packageName = requirement.package ?? "";
      const result = checkPackageInstalled(packageName);
      return {
        requirement,
        success: result.success,
        details: result.details,
      };
    }
    case "path-exists": {
      const targetPath = requirement.path ?? "";
      const exists = Boolean(targetPath) && fs.existsSync(targetPath);
      return {
        requirement,
        success: exists,
        details: exists ? `${targetPath} exists` : `${targetPath} missing`,
      };
    }
    case "samba-share": {
      const chain = verifyServiceChain();
      return {
        requirement,
        success: chain.success && chain.samba && chain.samba_shares > 0,
        details: chain.success
          ? `samba active=${chain.samba} shares=${chain.samba_shares}`
          : chain.error,
      };
    }
    case "sysctl-value": {
      const key = requirement.sysctlKey ?? "";
      try {
        const value = execSync(`sysctl -n ${JSON.stringify(key)}`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          shell: "/bin/bash",
        }).trim();
        return {
          requirement,
          success: value === (requirement.expectedValue ?? ""),
          details: `${key}=${value}`,
        };
      } catch (error) {
        return {
          requirement,
          success: false,
          details: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case "wireguard-active": {
      const status = checkServiceStatus(requirement.service ?? "wg-quick@wg0");
      return {
        requirement,
        success: status.success && status.status === "active",
        details: status.success ? `wireguard status=${status.status}` : status.error,
      };
    }
    case "docker-operational": {
      const chain = verifyServiceChain();
      return {
        requirement,
        success: chain.success && chain.docker && chain.docker_operational,
        details: chain.success
          ? `docker active=${chain.docker} operational=${chain.docker_operational}`
          : chain.error,
      };
    }
    case "nginx-config": {
      try {
        execSync("nginx -t", {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return {
          requirement,
          success: true,
          details: "nginx -t passed",
        };
      } catch (error) {
        try {
          execSync("sudo -n nginx -t", {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            shell: "/bin/bash",
          });
          return {
            requirement,
            success: true,
            details: "sudo nginx -t passed",
          };
        } catch {
          return {
            requirement,
            success: false,
            details: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }
    case "backup-test": {
      const result = runBackupTest();
      return {
        requirement,
        success: result.success,
        details: result.success ? `backup size=${result.sizeKb}KB` : result.error,
      };
    }
    case "gateway-health": {
      const url = requirement.url ?? "http://127.0.0.1:18789/healthz";
      try {
        execSync(`curl -fsS ${JSON.stringify(url)} >/dev/null`, {
          stdio: ["ignore", "ignore", "ignore"],
          timeout: 5000,
          shell: "/bin/bash",
        });
        return {
          requirement,
          success: true,
          details: `${url} reachable`,
        };
      } catch (error) {
        return {
          requirement,
          success: false,
          details: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
}

function verifyProposal(proposal: ActionProposal): VerificationReport | undefined {
  if (proposal.verification.length === 0) {
    return undefined;
  }
  return createVerificationReport(
    proposal.id,
    proposal.verification.map((requirement) => verifySingleRequirement(requirement)),
  );
}

async function attemptAutomaticRepair(
  proposal: ActionProposal,
  sudoContext: SudoContext | undefined,
): Promise<RepairAttempt[]> {
  const repairs: RepairAttempt[] = [];
  if (proposal.servicesTouched.length === 0) {
    return repairs;
  }

  const env: NodeJS.ProcessEnv = { ...process.env, DEBIAN_FRONTEND: "noninteractive" };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const repair: RepairAttempt = {
      proposalId: proposal.id,
      attempt,
      strategy: "verification-retry",
      status: "pending",
      notes: `Restart touched services: ${proposal.servicesTouched.join(", ")}`,
      startedAt: new Date().toISOString(),
    };
    try {
      for (const service of proposal.servicesTouched) {
        const command = `systemctl restart ${service}`;
        if (sudoContext) {
          await execAsSudo(command, sudoContext.password, env, 60_000);
        } else {
          await execAsUser(command, env, 60_000);
        }
      }
      repair.status = "succeeded";
      repair.finishedAt = new Date().toISOString();
    } catch (error) {
      repair.status = "failed";
      repair.finishedAt = new Date().toISOString();
      repair.error = error instanceof Error ? error.message : String(error);
    }
    repairs.push(repair);
  }

  return repairs;
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

// ── Ejecutar el flujo completo ───────────────────────────────────────────────

/**
 * Ejecuta el plan completo paso a paso.
 * - Pide la contraseña sudo si es necesario (hasta 3 intentos).
 * - Mantiene la sesión sudo activa durante toda la instalación.
 * - Persiste el estado de cada paso para poder retomar si se interrumpe.
 * - Ofrece reanudar desde el último paso fallido si se detecta progreso previo.
 * - Los pasos con requiresApproval=true esperan confirmación antes de ejecutarse.
 */
async function executePreparedProposals(
  plan: InstallPlan,
  proposals: ActionProposal[],
  options?: {
    bootstrap?: BootstrapResult;
    intent?: ConversationIntent;
    scan?: SystemScan;
    config?: InstallerConfig;
  },
): Promise<StepResult[]> {
  const bootstrap = options?.bootstrap;
  const results: StepResult[] = [];
  const planSignature = buildPlanSignature(plan);
  const previousState = readProgressState();
  const resolvedIntent = options?.intent ?? loadInstallerIntentForExecution(options?.scan);
  const resolvedConfig =
    options?.config ?? resolvedIntent?.installerConfig ?? loadInstallerConfigForRescue();
  const resolvedGoal: InstallationGoal =
    resolvedIntent?.goal ??
    buildConversationIntent(
      resolvedConfig,
      resolvedConfig.installMode ?? "adaptive",
      [],
      options?.scan,
    ).goal;
  let session =
    readInstallSessionState()?.planSignature === planSignature
      ? (readInstallSessionState() as InstallSessionState)
      : createInstallSessionState({
          planSignature,
          config: resolvedConfig,
          goal: resolvedGoal,
          fallbackPlan: plan,
          intent: resolvedIntent,
          proposals,
          snapshot: buildInstallationSnapshot(planSignature, options?.scan),
        });
  session.goal = resolvedGoal;
  session.config = resolvedConfig;
  session.intent = resolvedIntent;
  session.fallbackPlan = plan;
  session.proposals = proposals;
  session.snapshot = buildInstallationSnapshot(planSignature, options?.scan);
  writeInstallSessionState(session);
  const executionQueue = proposals.map((proposal) => ({
    proposal,
    step: proposalToInstallStep(proposal),
    stepId: resolveProposalStepId(proposal),
  }));

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
    clearInstallSessionState();
  }

  const completedSteps = loadCompletedSteps(planSignature);
  if (completedSteps.size > 0) {
    console.log(
      `\n  ${t.warn(`⚠ Instalación previa detectada: ${completedSteps.size} pasos ya completados.`)}`,
    );
    console.log(
      `  ${t.muted("s = reanudar | n = empezar de cero | d = desinstalar todo y reiniciar")}`,
    );

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const answer = await new Promise<string>((resolve) => {
      rl.question(`  ¿Cómo quieres continuar? (s/n/d): `, resolve);
    });
    rl.close();

    const resumeDecision = parseResumeDecision(answer);

    if (resumeDecision === "clean-restart") {
      const preservedSecrets = await captureInstallSecrets(plan, options?.bootstrap);
      console.log(
        `  ${t.warn("Se ejecutará una desinstalación completa antes de reiniciar la instalación.")}`,
      );
      await runGenericUninstall();
      await restoreInstallSecrets(preservedSecrets);
      clearStepState();
      clearInstallSessionState();
      completedSteps.clear();
      session = createInstallSessionState({
        planSignature,
        config: resolvedConfig,
        goal: resolvedGoal,
        fallbackPlan: plan,
        intent: resolvedIntent,
        proposals,
        snapshot: buildInstallationSnapshot(planSignature, options?.scan),
      });
      writeInstallSessionState(session);
      console.log(`  ${t.muted("Sistema limpiado. Empezando desde el principio.\n")}`);
    } else if (resumeDecision === "restart") {
      clearStepState();
      clearInstallSessionState();
      completedSteps.clear();
      session = createInstallSessionState({
        planSignature,
        config: resolvedConfig,
        goal: resolvedGoal,
        fallbackPlan: plan,
        intent: resolvedIntent,
        proposals,
        snapshot: buildInstallationSnapshot(planSignature, options?.scan),
      });
      writeInstallSessionState(session);
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
  console.log(`  Pasos totales   : ${executionQueue.length}`);
  console.log(`  Tiempo estimado : ~${plan.estimatedMinutes} minutos\n`);
  const rescueContextDefaults = {
    logPath: resolveRescueLogPath(),
    installerConfig: resolvedConfig,
    systemInfo: loadSystemInfoForRescue(),
  };
  const createSessionRescueContext = (params: {
    step: InstallStep;
    output: string;
    error?: string;
  }): RescueContext =>
    createRescueContext({
      session,
      plan,
      completedStepIds: completedSteps,
      ...rescueContextDefaults,
      ...params,
    });

  // ── 5. Bucle de pasos ─────────────────────────────────────────────────────

  try {
    for (const { proposal, step, stepId } of executionQueue) {
      session.currentProposalId = proposal.id;
      writeInstallSessionState(session);

      // Saltar pasos ya completados al reanudar
      if (completedSteps.has(stepId)) {
        console.log(`\n  ⏭  [${stepId}] ${step.description} ${t.muted("(reanudado — omitido)")}`);
        results.push({ stepId, status: "done" });
        continue;
      }

      console.log(`\n  ▶ [${stepId}] ${step.description}`);

      if (step.requiresApproval) {
        const request = await requestApproval(step, 120);
        let approvalDecision = await askApprovalWithRescue(request);

        if (approvalDecision === "rescue") {
          if (bootstrap) {
            const ctx = createSessionRescueContext({
              step,
              output: "",
            });
            const rescueResult = await runRescueMode(ctx, bootstrap);
            // "continue" → proceder con el paso; "cancel" → detener
            approvalDecision = rescueResult === "continue" ? "approved" : "rejected";
          } else {
            console.log(t.muted("  Modo rescate no disponible (proveedor IA no configurado)."));
            approvalDecision = "rejected";
          }
        }
        session.approvals[proposal.id] = {
          status: approvalDecision,
          timestamp: new Date().toISOString(),
        };
        writeInstallSessionState(session);

        if (approvalDecision === "rejected") {
          console.log(`\n  Paso ${stepId} rechazado. Deteniendo ejecución.`);
          const r: StepResult = {
            stepId,
            status: "skipped",
            error: "rechazado por el usuario",
          };
          results.push(r);
          saveStepStateForPlan(planSignature, stepId, "skipped", r.error);
          break;
        }
        if (approvalDecision === "timeout") {
          console.log(`\n  Paso ${stepId} ignorado por timeout. Deteniendo ejecución.`);
          const r: StepResult = {
            stepId,
            status: "skipped",
            error: "timeout de aprobación",
          };
          results.push(r);
          saveStepStateForPlan(planSignature, stepId, "skipped", r.error);
          break;
        }
      }

      const execution: ActionExecution = {
        proposalId: proposal.id,
        status: "running",
        startedAt: new Date().toISOString(),
        attempt: (session.executions[proposal.id]?.length ?? 0) + 1,
      };
      const enrichExecutionWithVerification = async (
        currentResult: StepResult,
        currentExecution: ActionExecution,
      ): Promise<StepResult> => {
        if (currentResult.status !== "done") {
          return currentResult;
        }

        let verification = verifyProposal(proposal);
        if (verification && !verification.success) {
          const repairs = await attemptAutomaticRepair(proposal, sudoCtx);
          for (const repair of repairs) {
            upsertRepair(session, repair);
            writeInstallSessionState(session);
            if (repair.status === "succeeded") {
              verification = verifyProposal(proposal);
              if (verification?.success) {
                break;
              }
            }
          }
        }
        if (verification) {
          currentExecution.verification = verification;
          currentResult.verification = verification;
          if (!verification.success) {
            currentResult.status = "failed";
            currentResult.error = verification.summary;
            currentExecution.status = "failed";
            currentExecution.error = verification.summary;
          }
        }
        return currentResult;
      };

      let result = await executeStep(step, sudoCtx);
      execution.finishedAt = new Date().toISOString();
      execution.status = result.status;
      execution.output = result.output;
      execution.error = result.error;
      result = await enrichExecutionWithVerification(result, execution);

      upsertExecution(session, execution);

      let stopAfterFailure = false;
      if (result.status === "failed") {
        let rescuedAndRetried = false;
        if (bootstrap) {
          const activateRescue = await askConfirmationInline(
            "¿Activar el modo rescate para diagnosticar el error?",
          );
          if (activateRescue) {
            const repairAttempt: RepairAttempt = {
              proposalId: proposal.id,
              attempt: (session.repairs[proposal.id]?.length ?? 0) + 1,
              strategy: "ai-rescue",
              status: "pending",
              notes: result.error ?? "AI rescue requested after failed execution.",
              startedAt: new Date().toISOString(),
            };
            const ctx = createSessionRescueContext({
              step,
              output: result.output ?? "",
              error: result.error,
            });
            const rescueDecision = await runRescueMode(ctx, bootstrap);
            repairAttempt.status = rescueDecision === "continue" ? "succeeded" : "cancelled";
            repairAttempt.finishedAt = new Date().toISOString();
            upsertRepair(session, repairAttempt);
            writeInstallSessionState(session);

            if (rescueDecision === "continue") {
              // Un único reintento tras el rescate
              console.log(`\n  ${t.muted("Reintentando paso " + stepId + " tras rescate...")}\n`);
              const retryResult = await executeStep(step, sudoCtx);
              const retryExecution: ActionExecution = {
                proposalId: proposal.id,
                status: retryResult.status,
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                attempt: (session.executions[proposal.id]?.length ?? 0) + 1,
                output: retryResult.output,
                error: retryResult.error,
              };
              const verifiedRetryResult = await enrichExecutionWithVerification(
                retryResult,
                retryExecution,
              );
              retryExecution.status = verifiedRetryResult.status;
              retryExecution.error = verifiedRetryResult.error;
              upsertExecution(session, retryExecution);
              writeInstallSessionState(session);
              if (verifiedRetryResult.status === "done") {
                result = verifiedRetryResult;
                rescuedAndRetried = true;
              } else {
                console.error(`\n  El reintento del paso ${stepId} también ha fallado.`);
              }
            }
          }
        }
        if (!rescuedAndRetried) {
          console.error(`\n  El paso ${stepId} ha fallado. Deteniendo ejecución.`);
          console.log(
            `  ${t.muted("Vuelve a ejecutar 'laia-arch install' para retomar desde aquí.")}`,
          );
          stopAfterFailure = true;
        }
      }

      results.push(result);
      saveStepStateForPlan(planSignature, stepId, result.status, result.error);

      if (stopAfterFailure) {
        break;
      }

      if (!session.completedProposalIds.includes(proposal.id)) {
        session.completedProposalIds.push(proposal.id);
      }
      completedSteps.add(stepId);
      session.currentProposalId = undefined;
      session.snapshot = buildInstallationSnapshot(planSignature, options?.scan);
      writeInstallSessionState(session);
      console.log(`  ✓ Paso ${stepId} completado.`);
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
    `\n  Resultado: ${done} completados, ${failed} fallidos, ${skipped} omitidos de ${executionQueue.length} pasos.`,
  );

  // Si todo fue bien, limpiar el archivo de estado
  if (failed === 0 && skipped === 0 && done === executionQueue.length) {
    clearStepState();
    clearInstallSessionState();
  }

  return results;
}

/**
 * Camino determinista/fallback: sigue usando plan-generator.ts y deriva
 * ActionProposal desde ese plan.
 */
export async function executePlan(
  plan: InstallPlan,
  options?: {
    bootstrap?: BootstrapResult;
    intent?: ConversationIntent;
    scan?: SystemScan;
    config?: InstallerConfig;
  },
): Promise<StepResult[]> {
  const resolvedConfig =
    options?.config ?? options?.intent?.installerConfig ?? loadInstallerConfigForRescue();
  const proposals = buildActionProposalsFromPlan(plan, resolvedConfig);
  return executePreparedProposals(plan, proposals, options);
}

/**
 * Camino agentic directo: ejecuta propuestas ya razonadas por el agente sin
 * pasar por plan-generator.ts. Mantiene un plan fallback solo para persistencia,
 * resumen y reanudación segura.
 */
export async function executeActionProposals(
  proposals: ActionProposal[],
  options?: {
    bootstrap?: BootstrapResult;
    intent?: ConversationIntent;
    scan?: SystemScan;
    config?: InstallerConfig;
    fallbackPlan?: InstallPlan;
  },
): Promise<StepResult[]> {
  const fallbackPlan = options?.fallbackPlan ?? buildFallbackPlanFromProposals(proposals);
  return executePreparedProposals(fallbackPlan, proposals, options);
}
