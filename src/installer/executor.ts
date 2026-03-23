// executor.ts — Ejecucion del plan de instalacion (pendiente de implementacion)

import type { InstallPlan, InstallStep } from "./types.js";

export type ExecutionStatus = "pending" | "running" | "done" | "failed";

export interface StepResult {
  stepId: string;
  status: ExecutionStatus;
  output?: string;
  error?: string;
}

/** Executes an installation plan step by step, requiring approval where needed. */
export async function executePlan(_plan: InstallPlan): Promise<StepResult[]> {
  throw new Error("executePlan: no implementado todavia");
}

/** Executes a single installation step. */
export async function executeStep(_step: InstallStep): Promise<StepResult> {
  throw new Error("executeStep: no implementado todavia");
}
