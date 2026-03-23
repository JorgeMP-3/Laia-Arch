// plan-generator.ts — Generacion del plan de instalacion (pendiente de implementacion)

import type { InstallerConfig, InstallPlan } from "./types.js";

export type PlanStatus = "draft" | "approved" | "executing";

/** Generates an ordered installation plan from the collected installer config. */
export async function generatePlan(_config: InstallerConfig): Promise<InstallPlan> {
  throw new Error("generatePlan: no implementado todavia");
}
