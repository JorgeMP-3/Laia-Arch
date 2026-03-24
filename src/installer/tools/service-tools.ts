import { execSync } from "node:child_process";
import { requestApproval, waitForApproval } from "../hitl-controller.js";
import type { InstallStep } from "../types.js";
import { logToolCall } from "./logger.js";

type ToolFailure = { success: false; error: string; retryable: boolean };

function fail(error: string, retryable: boolean): ToolFailure {
  return { success: false, error, retryable };
}

function summarizeExecError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isSafePackageName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9+.-]*$/.test(value);
}

function isSafeServiceName(value: string): boolean {
  return /^[A-Za-z0-9@_.:-]+$/.test(value);
}

function classifyCommandFailure(message: string): ToolFailure {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("unable to locate package") ||
    normalized.includes("invalid package name") ||
    normalized.includes("permission denied")
  ) {
    return fail(message, false);
  }
  return fail(message, true);
}

export async function installPackage(packages: string[]):
  Promise<{ success: true; output: string } | ToolFailure> {
  const params = { packages };
  let result: { success: true; output: string } | ToolFailure;
  if (!Array.isArray(packages) || packages.length === 0) {
    result = fail("debes indicar al menos un paquete", false);
    logToolCall("install_package", params, result);
    return result;
  }
  if (!packages.every((entry) => isSafePackageName(entry))) {
    result = fail("nombre de paquete no permitido", false);
    logToolCall("install_package", params, result);
    return result;
  }

  const step: InstallStep = {
    id: `install-package-${Date.now()}`,
    phase: 0,
    description: `Instalar paquetes: ${packages.join(", ")}`,
    commands: [`sudo apt-get install -y ${packages.join(" ")}`],
    requiresApproval: true,
  };

  try {
    const approval = await requestApproval(step, 120);
    const decision = await waitForApproval(approval);
    if (decision !== "approved") {
      result = fail(
        decision === "timeout" ? "timeout esperando aprobación" : "instalación rechazada por el usuario",
        false,
      );
      logToolCall("install_package", params, result);
      return result;
    }

    const output = execSync(`sudo apt-get install -y ${packages.join(" ")}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    result = { success: true, output: output.trim() };
  } catch (error) {
    result = classifyCommandFailure(summarizeExecError(error));
  }

  logToolCall("install_package", params, result);
  return result;
}

export function enableService(service: string):
  | { success: true }
  | ToolFailure {
  const params = { service };
  let result: { success: true } | ToolFailure;
  const normalized = service.trim();
  if (!normalized || !isSafeServiceName(normalized)) {
    result = fail("nombre de servicio no permitido", false);
    logToolCall("enable_service", params, result);
    return result;
  }

  try {
    execSync(`sudo systemctl enable ${JSON.stringify(normalized)} && sudo systemctl start ${JSON.stringify(normalized)}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    result = { success: true };
  } catch (error) {
    result = classifyCommandFailure(summarizeExecError(error));
  }

  logToolCall("enable_service", params, result);
  return result;
}

export function configureUfw(
  port: number,
  protocol: "tcp" | "udp",
  action: "allow" | "deny",
): { success: true } | ToolFailure {
  const params = { port, protocol, action };
  let result: { success: true } | ToolFailure;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    result = fail("puerto fuera de rango", false);
    logToolCall("configure_ufw", params, result);
    return result;
  }
  if (!["tcp", "udp"].includes(protocol) || !["allow", "deny"].includes(action)) {
    result = fail("protocolo o acción no permitidos", false);
    logToolCall("configure_ufw", params, result);
    return result;
  }

  try {
    execSync(`sudo ufw ${action} ${port}/${protocol}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    result = { success: true };
  } catch (error) {
    result = classifyCommandFailure(summarizeExecError(error));
  }

  logToolCall("configure_ufw", params, result);
  return result;
}
