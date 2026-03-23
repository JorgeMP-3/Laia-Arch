// hitl-controller.ts — Control humano en el bucle (pendiente de implementacion)

import type { ApprovalRequest, ApprovalResult, InstallStep } from "./types.js";

export type HitlAction = "approve" | "reject" | "modify";

/** Requests human approval for a step and waits for the response. */
export async function requestApproval(
  _step: InstallStep,
  _timeoutSeconds: number,
): Promise<ApprovalRequest> {
  throw new Error("requestApproval: no implementado todavia");
}

/** Waits for a human approval decision on a pending request. */
export async function waitForApproval(_requestId: string): Promise<ApprovalResult> {
  throw new Error("waitForApproval: no implementado todavia");
}
