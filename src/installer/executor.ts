// executor.ts — Ejecución del plan de instalación paso a paso con HITL

import { exec, execSync } from "node:child_process";
import * as readline from "node:readline";
import { promisify } from "node:util";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import { requestApproval, waitForApproval } from "./hitl-controller.js";
import type { InstallPlan, InstallStep } from "./types.js";

const execAsync = promisify(exec);

export type ExecutionStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StepResult {
  stepId: string;
  status: ExecutionStatus;
  output?: string;
  error?: string;
}

async function checkSudoPermissions(): Promise<boolean> {
  try {
    execSync("sudo -n hostnamectl --version 2>/dev/null || sudo -n true", {
      stdio: "ignore",
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Ejecuta un único paso del plan y devuelve el resultado. */
export async function executeStep(step: InstallStep): Promise<StepResult> {
  const result: StepResult = { stepId: step.id, status: "running" };
  const outputs: string[] = [];

  try {
    for (const cmd of step.commands) {
      console.log(`    $ ${cmd}`);
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: 300_000, // 5 minutos por comando
        env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
      });
      const out = stdout.trim();
      const err = stderr.trim();
      if (out) {
        console.log(`      ${out.replace(/\n/g, "\n      ")}`);
        outputs.push(out);
      }
      // Algunos instaladores escriben progreso en stderr aunque no sea un error
      if (err && !out) {
        console.log(`      ${err.replace(/\n/g, "\n      ")}`);
      }
    }

    result.status = "done";
    result.output = outputs.join("\n");
  } catch (err) {
    result.status = "failed";
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`\n  ERROR en paso ${step.id}:`);
    console.error(`  ${result.error}`);

    // Intentar rollback si está definido
    if (step.rollback) {
      console.log(`\n  Ejecutando rollback: ${step.rollback}`);
      try {
        await execAsync(step.rollback, { timeout: 60_000 });
        console.log("  Rollback completado.");
      } catch (rbErr) {
        console.error("  Rollback falló:", rbErr instanceof Error ? rbErr.message : String(rbErr));
      }
    }
  }

  return result;
}

/**
 * Ejecuta el plan completo paso a paso.
 * Los pasos con requiresApproval=true esperan confirmación antes de ejecutarse.
 * Se detiene en el primer paso fallido o rechazado.
 */
export async function executePlan(plan: InstallPlan): Promise<StepResult[]> {
  const results: StepResult[] = [];

  const sudoAvailable = await checkSudoPermissions();
  if (!sudoAvailable) {
    console.log(`\n  ${t.warn("⚠ Permisos sudo insuficientes detectados.")}`);
    console.log(`  ${t.muted("El instalador necesita sudo para ejecutar comandos del sistema.")}`);
    console.log(`\n  ${t.step("Configura los permisos con:")}`);
    console.log(`  ${t.brand("sudo bash scripts/setup-sudoers.sh")}`);
    console.log(`\n  ${t.muted("Luego vuelve a ejecutar el instalador.\n")}`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const answer = await new Promise<string>((resolve) => {
      rl.question("¿Continuar de todas formas? (s/n): ", resolve);
    });
    rl.close();

    const normalized = answer.toLowerCase().trim();
    if (normalized !== "s" && normalized !== "si" && normalized !== "sí") {
      process.exit(0);
    }
  }

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║            EJECUTANDO PLAN DE INSTALACIÓN               ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`  Pasos totales   : ${plan.steps.length}`);
  console.log(`  Tiempo estimado : ~${plan.estimatedMinutes} minutos\n`);

  for (const step of plan.steps) {
    console.log(`\n  ▶ [${step.id}] ${step.description}`);

    if (step.requiresApproval) {
      const request = await requestApproval(step, 120);
      const decision = await waitForApproval(request);

      if (decision === "rejected") {
        console.log(`\n  Paso ${step.id} rechazado. Deteniendo ejecución.`);
        results.push({ stepId: step.id, status: "skipped", error: "rechazado por el usuario" });
        break;
      }
      if (decision === "timeout") {
        console.log(`\n  Paso ${step.id} ignorado por timeout. Deteniendo ejecución.`);
        results.push({ stepId: step.id, status: "skipped", error: "timeout de aprobación" });
        break;
      }
    }

    const result = await executeStep(step);
    results.push(result);

    if (result.status === "failed") {
      console.error(`\n  El paso ${step.id} ha fallado. Deteniendo ejecución.`);
      break;
    }

    console.log(`  ✓ Paso ${step.id} completado.`);
  }

  // Resumen final
  const done = results.filter((r) => r.status === "done").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  console.log(
    `\n  Resultado: ${done} completados, ${failed} fallidos, ${skipped} omitidos de ${plan.steps.length} pasos.`,
  );

  return results;
}
