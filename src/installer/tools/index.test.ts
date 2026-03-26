import { describe, expect, it } from "vitest";
import { TOOL_HANDLERS } from "./index.js";

// Helper: verifica que un objeto cumple el contrato ToolResultEnvelope
function assertEnvelopeShape(result: Record<string, unknown>): void {
  expect(typeof result["success"]).toBe("boolean");
  expect(typeof result["retryable"]).toBe("boolean");
  expect(result["observed_state"]).toBeDefined();
  expect(typeof result["observed_state"]).toBe("object");
  expect(Array.isArray(result["changed_files"])).toBe(true);
  expect(Array.isArray(result["services_touched"])).toBe(true);
}

describe("installer tool envelopes", () => {
  it("normalizes read_file failures into the shared envelope", async () => {
    const result = (await TOOL_HANDLERS["read_file"]({
      path: "/tmp/no-permitido",
    })) as Record<string, unknown>;

    assertEnvelopeShape(result);
    expect(result["success"]).toBe(false);
    expect(result["error"]).toBeTruthy();
  });

  it("keeps service status checks in the shared envelope shape", async () => {
    const result = (await TOOL_HANDLERS["check_service_status"]({
      service: "definitely-missing-service-for-laia-test",
    })) as Record<string, unknown>;

    assertEnvelopeShape(result);
    expect(result["services_touched"]).toContain("definitely-missing-service-for-laia-test");
    const observed = result["observed_state"] as Record<string, unknown>;
    expect(observed).toHaveProperty("status");
  });

  it("infers changed_files correctly for write_file", async () => {
    // write_file a una ruta que no existe fallará, pero el envelope debe incluir la ruta
    const result = (await TOOL_HANDLERS["write_file"]({
      path: "/tmp/laia-test-write-envelope.txt",
      content: "test",
    })) as Record<string, unknown>;

    assertEnvelopeShape(result);
    const changedFiles = result["changed_files"] as string[];
    expect(changedFiles).toContain("/tmp/laia-test-write-envelope.txt");
  });

  it("get_system_info always returns the envelope shape", async () => {
    const result = (await TOOL_HANDLERS["get_system_info"]({})) as Record<string, unknown>;
    assertEnvelopeShape(result);
    expect(typeof result["success"]).toBe("boolean");
  });

  it("verify_dns_resolution returns the envelope shape", async () => {
    const result = (await TOOL_HANDLERS["verify_dns_resolution"]({
      hostname: "localhost",
    })) as Record<string, unknown>;

    assertEnvelopeShape(result);
    expect(result["services_touched"]).toContain("bind9");
  });

  it("check_port_available returns the envelope shape", async () => {
    const result = (await TOOL_HANDLERS["check_port_available"]({
      port: 65432, // improbable que esté ocupado
    })) as Record<string, unknown>;

    assertEnvelopeShape(result);
  });
});
