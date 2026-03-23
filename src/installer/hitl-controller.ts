// hitl-controller.ts — Control humano en el bucle (Human-In-The-Loop)
// Muestra cada paso antes de ejecutarlo y espera aprobación explícita.

import * as readline from "node:readline";
import type { ApprovalRequest, ApprovalResult, InstallStep } from "./types.js";

const ACCEPT = new Set(["s", "si", "sí", "y", "yes", "ok", "adelante", "aprobado"]);
const REJECT = new Set(["n", "no", "rechazar", "cancelar"]);

/**
 * Prepara y muestra un resumen del paso al administrador.
 * Devuelve el ApprovalRequest listo para pasarlo a waitForApproval.
 */
export async function requestApproval(
  step: InstallStep,
  timeoutSeconds: number,
): Promise<ApprovalRequest> {
  const request: ApprovalRequest = {
    id: `approval-${step.id}-${Date.now()}`,
    step,
    timestamp: new Date(),
    timeoutSeconds,
  };

  const divider = "─".repeat(62);
  console.log(`\n${divider}`);
  console.log(`  APROBACIÓN REQUERIDA — ${step.id}`);
  console.log(divider);
  console.log(`  Descripción : ${step.description}`);
  console.log(`  Fase        : ${step.phase}`);

  if (step.commands.length > 0) {
    console.log("\n  Comandos a ejecutar:");
    for (const cmd of step.commands) {
      console.log(`    $ ${cmd}`);
    }
  }

  if (step.rollback) {
    console.log(`\n  Rollback disponible : ${step.rollback}`);
  }

  console.log();

  return request;
}

/**
 * Espera la decisión del administrador.
 * Acepta: s / si / y / yes / ok / adelante / aprobado
 * Rechaza: n / no / rechazar / cancelar
 * Timeout: devuelve "timeout" si no hay respuesta antes del plazo.
 */
export async function waitForApproval(request: ApprovalRequest): Promise<ApprovalResult> {
  return new Promise<ApprovalResult>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    let settled = false;

    const settle = (result: ApprovalResult) => {
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

    rl.question(`  ¿Aprobar este paso? (s/n) [timeout ${request.timeoutSeconds}s]: `, (answer) => {
      const norm = answer.toLowerCase().trim();
      if (ACCEPT.has(norm)) {
        settle("approved");
      } else if (REJECT.has(norm)) {
        settle("rejected");
      } else {
        // Respuesta ambigua: preguntar de nuevo de forma simple
        console.log("  Responde 's' para aprobar o 'n' para rechazar.");
        settle("rejected");
      }
    });
  });
}
