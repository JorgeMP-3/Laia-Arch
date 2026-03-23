// conversation.ts — Fase 2: Conversacion con la IA (pendiente de implementacion)

import type { SystemScan, BootstrapResult, InstallerConfig } from "./types.js";

export type ConversationState = "idle" | "active" | "complete";

/** Runs the conversational phase with the AI using collected scan data. */
export async function runConversation(
  _bootstrap: BootstrapResult,
  _scan: SystemScan,
): Promise<InstallerConfig> {
  throw new Error("runConversation: no implementado todavia");
}
