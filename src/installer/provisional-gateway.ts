import { randomBytes, randomUUID } from "node:crypto";
import { callGateway } from "../gateway/call.js";
import { ADMIN_SCOPE } from "../gateway/method-scopes.js";
import { startGatewayServer, type GatewayServer } from "../gateway/server.js";
import { getResolvedConsoleSettings } from "../logging/console.js";
import {
  getResolvedLoggerSettings,
  setLoggerOverride,
  type LoggerSettings,
} from "../logging/logger.js";
import { loggingState } from "../logging/state.js";
import type { BootstrapResult } from "./types.js";

const PROVISIONAL_GATEWAY_PORT_CANDIDATES = [18791, 18792, 18793, 18794, 18795];
const DEFAULT_PROVISIONAL_GATEWAY_CALL_TIMEOUT_MS = 120_000;
const INSTALLER_NO_TOOLS_SYSTEM_PROMPT_SUFFIX =
  "INSTRUCCION OPERATIVA DEL INSTALADOR: no llames herramientas, plugins ni funciones. " +
  "Responde solo con texto plano para la conversación del instalador.";

type GatewayAgentPayloadText = {
  text?: string;
};

type GatewayAgentResult = {
  payloads?: GatewayAgentPayloadText[];
  [key: string]: unknown;
};

export type InstallerGatewayAgentResponse = {
  runId: string;
  status: "ok" | "error";
  summary?: string;
  result?: GatewayAgentResult;
};

export type ProvisionalGatewayCallOptions = {
  message: string;
  systemPrompt: string;
  sessionKey?: string;
  thinking?: string;
  timeoutMs?: number;
};

export interface ProvisionalGateway {
  start(): Promise<void>;
  callAgentTurn(opts: ProvisionalGatewayCallOptions): Promise<InstallerGatewayAgentResponse>;
  close(reason?: string): Promise<void>;
}

function createEphemeralGatewayToken(): string {
  return randomBytes(36).toString("base64url");
}

function createInstallerConversationSessionKey(): string {
  return `installer:conversation:${randomUUID()}`;
}

function createGatewayUrl(port: number): string {
  return `ws://127.0.0.1:${port}`;
}

function enterSilentInstallerGatewayConsoleMode(): () => void {
  const previousOverride = (loggingState.overrideSettings as LoggerSettings | null) ?? null;
  const resolvedLogger = getResolvedLoggerSettings();
  const resolvedConsole = getResolvedConsoleSettings();
  setLoggerOverride({
    level: resolvedLogger.level,
    file: resolvedLogger.file,
    maxFileBytes: resolvedLogger.maxFileBytes,
    consoleLevel: "silent",
    consoleStyle: resolvedConsole.style,
  });
  return () => {
    setLoggerOverride(previousOverride);
  };
}

async function withSkippedInstallerGatewaySidecars<T>(operation: () => Promise<T>): Promise<T> {
  const previous = process.env.LAIA_ARCH_SKIP_CANVAS_HOST;
  const previousBrowser = process.env.LAIA_ARCH_SKIP_BROWSER_CONTROL_SERVER;
  process.env.LAIA_ARCH_SKIP_CANVAS_HOST = "1";
  process.env.LAIA_ARCH_SKIP_BROWSER_CONTROL_SERVER = "1";
  try {
    return await operation();
  } finally {
    if (previous == null) {
      delete process.env.LAIA_ARCH_SKIP_CANVAS_HOST;
    } else {
      process.env.LAIA_ARCH_SKIP_CANVAS_HOST = previous;
    }
    if (previousBrowser == null) {
      delete process.env.LAIA_ARCH_SKIP_BROWSER_CONTROL_SERVER;
    } else {
      process.env.LAIA_ARCH_SKIP_BROWSER_CONTROL_SERVER = previousBrowser;
    }
  }
}

export function createProvisionalGateway(bootstrap: BootstrapResult): ProvisionalGateway {
  let gatewayServer: GatewayServer | undefined;
  let gatewayPort: number | undefined;
  let restoreSilentConsole: (() => void) | undefined;
  const gatewayToken = createEphemeralGatewayToken();
  const conversationSessionKey = createInstallerConversationSessionKey();

  const ensureStarted = async (): Promise<number> => {
    if (gatewayServer && gatewayPort) {
      return gatewayPort;
    }
    const restoreConsole = enterSilentInstallerGatewayConsoleMode();
    for (const candidatePort of PROVISIONAL_GATEWAY_PORT_CANDIDATES) {
      try {
        gatewayServer = await withSkippedInstallerGatewaySidecars(async () => {
          return await startGatewayServer(candidatePort, {
            bind: "loopback",
            controlUiEnabled: false,
            openAiChatCompletionsEnabled: false,
            openResponsesEnabled: false,
            auth: {
              mode: "token",
              token: gatewayToken,
              allowTailscale: false,
            },
          });
        });
        gatewayPort = candidatePort;
        restoreSilentConsole = restoreConsole;
        return candidatePort;
      } catch {
        gatewayServer = undefined;
        gatewayPort = undefined;
      }
    }
    restoreConsole();
    throw new Error(
      `No se pudo arrancar el gateway provisional. Puertos probados: ${PROVISIONAL_GATEWAY_PORT_CANDIDATES.join(", ")}`,
    );
  };

  return {
    async start(): Promise<void> {
      await ensureStarted();
    },

    async callAgentTurn(
      opts: ProvisionalGatewayCallOptions,
    ): Promise<InstallerGatewayAgentResponse> {
      const port = await ensureStarted();
      const timeoutMs = opts.timeoutMs ?? DEFAULT_PROVISIONAL_GATEWAY_CALL_TIMEOUT_MS;
      return await callGateway<InstallerGatewayAgentResponse>({
        url: createGatewayUrl(port),
        token: gatewayToken,
        scopes: [ADMIN_SCOPE],
        method: "agent",
        expectFinal: true,
        timeoutMs,
        params: {
          message: opts.message,
          provider: bootstrap.providerId,
          model: bootstrap.model,
          sessionKey: opts.sessionKey ?? conversationSessionKey,
          thinking: opts.thinking,
          timeout: timeoutMs,
          deliver: false,
          channel: "webchat",
          idempotencyKey: randomUUID(),
          extraSystemPrompt: `${opts.systemPrompt}\n\n${INSTALLER_NO_TOOLS_SYSTEM_PROMPT_SUFFIX}`,
        },
      });
    },

    async close(reason = "installer provisional gateway shutdown"): Promise<void> {
      if (!gatewayServer) {
        restoreSilentConsole?.();
        restoreSilentConsole = undefined;
        return;
      }
      const server = gatewayServer;
      gatewayServer = undefined;
      gatewayPort = undefined;
      try {
        await server.close({ reason });
      } finally {
        restoreSilentConsole?.();
        restoreSilentConsole = undefined;
      }
    },
  };
}
