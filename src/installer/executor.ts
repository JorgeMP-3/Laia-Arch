// executor.ts — Ejecución del plan de instalación paso a paso con HITL

import { execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import { requestApproval, waitForApproval } from "./hitl-controller.js";
import type { InstallPlan, InstallStep } from "./types.js";

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

// ── Ruta del archivo de estado ────────────────────────────────────────────────

const STATE_FILE = path.join(os.homedir(), ".laia-arch", "install-progress.json");

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

async function checkSudoPasswordless(): Promise<boolean> {
  try {
    execSync("sudo -n true", { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// ── Pedir contraseña ocultando caracteres ─────────────────────────────────────

function askSudoPassword(prompt: string): Promise<string> {
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

async function validateSudoPassword(password: string): Promise<boolean> {
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
  return new Promise((resolve, reject) => {
    const proc = spawn("sudo", ["-S", "-p", "", "bash", "-c", cmd], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`Timeout (${Math.round(timeoutMs / 60_000)} min): ${cmd.slice(0, 80)}`));
    }, timeoutMs);

    proc.stdin.write(`${password}\n`);
    proc.stdin.end();

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        // Incluir las últimas 20 líneas de stderr para diagnóstico
        const errLines = stderr.trim().split("\n");
        const errSummary = errLines.slice(-20).join("\n");
        reject(new Error(`Exit ${code}: ${errSummary || stdout.trim().slice(-500)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Ejecutar comando sin sudo (para comandos de usuario) ─────────────────────

async function execAsUser(
  cmd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bash", ["-c", cmd], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`Timeout (${Math.round(timeoutMs / 60_000)} min): ${cmd.slice(0, 80)}`));
    }, timeoutMs);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const errLines = stderr.trim().split("\n");
        const errSummary = errLines.slice(-20).join("\n");
        reject(new Error(`Exit ${code}: ${errSummary || stdout.trim().slice(-500)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
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
  const timeoutMs = step.timeout ?? 600_000; // 10 min por defecto
  const maxRetries = step.maxRetries ?? 2;

  try {
    for (const cmd of step.commands) {
      console.log(`    $ ${cmd}`);

      let stdout = "";
      let stderr = "";

      // Reintentar ante errores transitorios
      let lastErr: Error | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (sudoContext !== undefined) {
            ({ stdout, stderr } = await execAsSudo(cmd, sudoContext.password, env, timeoutMs));
          } else {
            ({ stdout, stderr } = await execAsUser(cmd, env, timeoutMs));
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
      const err = stderr.trim();
      if (out) {
        console.log(`      ${out.replace(/\n/g, "\n      ")}`);
        outputs.push(out);
      }
      // Algunos instaladores usan stderr para progreso aunque no sea un error
      if (err && !out) {
        console.log(`      ${err.replace(/\n/g, "\n      ")}`);
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
export async function executePlan(plan: InstallPlan): Promise<StepResult[]> {
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
        const decision = await waitForApproval(request);

        if (decision === "rejected") {
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
        if (decision === "timeout") {
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
