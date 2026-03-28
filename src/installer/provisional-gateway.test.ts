import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getResolvedConsoleSettings } from "../logging/console.js";
import { setLoggerOverride } from "../logging/logger.js";
import { loggingState } from "../logging/state.js";
import type { BootstrapResult } from "./types.js";

const callGatewayMock = vi.fn();
const startGatewayServerMock = vi.fn();

vi.mock("../gateway/call.js", () => ({
  callGateway: callGatewayMock,
}));

vi.mock("../gateway/server.js", () => ({
  startGatewayServer: startGatewayServerMock,
}));

const bootstrap: BootstrapResult = {
  providerId: "openai-codex",
  model: "gpt-5.4",
  profileId: "openai-codex:default",
  authMethod: "oauth",
  authType: "oauth",
  supportsReasoning: true,
};

describe("createProvisionalGateway", () => {
  let previousSkipCanvasHost: string | undefined;
  let previousSkipBrowserControlServer: string | undefined;
  let previousLoggerOverride: unknown;

  beforeEach(() => {
    callGatewayMock.mockReset();
    startGatewayServerMock.mockReset();
    previousSkipCanvasHost = process.env.LAIA_ARCH_SKIP_CANVAS_HOST;
    previousSkipBrowserControlServer = process.env.LAIA_ARCH_SKIP_BROWSER_CONTROL_SERVER;
    previousLoggerOverride = loggingState.overrideSettings;
    delete process.env.LAIA_ARCH_SKIP_CANVAS_HOST;
    delete process.env.LAIA_ARCH_SKIP_BROWSER_CONTROL_SERVER;
    setLoggerOverride(null);
  });

  afterEach(() => {
    if (previousSkipCanvasHost == null) {
      delete process.env.LAIA_ARCH_SKIP_CANVAS_HOST;
    } else {
      process.env.LAIA_ARCH_SKIP_CANVAS_HOST = previousSkipCanvasHost;
    }
    if (previousSkipBrowserControlServer == null) {
      delete process.env.LAIA_ARCH_SKIP_BROWSER_CONTROL_SERVER;
    } else {
      process.env.LAIA_ARCH_SKIP_BROWSER_CONTROL_SERVER = previousSkipBrowserControlServer;
    }
    setLoggerOverride((previousLoggerOverride as Parameters<typeof setLoggerOverride>[0]) ?? null);
  });

  it("starts quietly, skips optional sidecars, and restores the logger on close", async () => {
    setLoggerOverride({
      level: "info",
      file: "/tmp/openclaw-provisional-gateway-test.log",
      maxFileBytes: 4096,
      consoleLevel: "warn",
      consoleStyle: "compact",
    });

    startGatewayServerMock.mockImplementation(async () => {
      expect(process.env.LAIA_ARCH_SKIP_CANVAS_HOST).toBe("1");
      expect(process.env.LAIA_ARCH_SKIP_BROWSER_CONTROL_SERVER).toBe("1");
      expect(getResolvedConsoleSettings().level).toBe("silent");
      return {
        close: vi.fn(async () => undefined),
      };
    });
    callGatewayMock.mockResolvedValue({
      status: "ok",
      runId: "run-1",
      result: { payloads: [{ text: "hola" }] },
    });

    const { createProvisionalGateway } = await import("./provisional-gateway.js");
    const gateway = createProvisionalGateway(bootstrap);

    await gateway.start();
    await gateway.callAgentTurn({
      message: "Hola",
      systemPrompt: "SYSTEM",
    });

    expect(startGatewayServerMock).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        bind: "loopback",
        controlUiEnabled: false,
        openAiChatCompletionsEnabled: false,
        openResponsesEnabled: false,
      }),
    );
    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectFinal: true,
        timeoutMs: 120_000,
        params: expect.objectContaining({
          provider: "openai-codex",
          model: "gpt-5.4",
          timeout: 120_000,
          extraSystemPrompt: expect.stringContaining(
            "no llames herramientas, plugins ni funciones",
          ),
        }),
      }),
    );
    expect(process.env.LAIA_ARCH_SKIP_CANVAS_HOST).toBeUndefined();
    expect(process.env.LAIA_ARCH_SKIP_BROWSER_CONTROL_SERVER).toBeUndefined();
    expect(getResolvedConsoleSettings().level).toBe("silent");

    await gateway.close();

    expect(getResolvedConsoleSettings().level).toBe("warn");
  });
});
