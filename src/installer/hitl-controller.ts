// hitl-controller.ts — Control humano en el bucle (Human-In-The-Loop)
// Muestra cada paso antes de ejecutarlo y espera aprobación explícita.

import * as readline from "node:readline";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
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

  const divider = t.brandDim("─".repeat(62));
  console.log(`\n${divider}`);
  console.log(`  ${t.label("APROBACIÓN REQUERIDA")} ${t.dim("—")} ${t.brand(step.id)}`);
  console.log(divider);
  console.log(`  ${t.label("Descripción")} : ${t.value(step.description)}`);
  console.log(`  ${t.label("Fase")}        : ${t.dim(String(step.phase))}`);

  if (step.commands.length > 0) {
    console.log(`\n  ${t.dim("Comandos a ejecutar:")}`);
    for (const cmd of step.commands) {
      console.log(t.cmd(cmd));
    }
  }

  if (step.rollback) {
    console.log(`\n  ${t.dim("Rollback disponible:")} ${t.muted(step.rollback)}`);
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
