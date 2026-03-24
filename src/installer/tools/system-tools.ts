import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SystemScan } from "../types.js";
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

function isAllowedReadPath(candidatePath: string): boolean {
  const resolved = path.resolve(candidatePath);
  return (
    resolved.startsWith("/etc/") ||
    resolved === "/etc" ||
    resolved.startsWith("/srv/") ||
    resolved === "/srv" ||
    resolved.startsWith("/home/laia-arch/") ||
    resolved === "/home/laia-arch"
  );
}

export function getSystemInfo():
  | { success: true; scan: SystemScan }
  | ToolFailure {
  const params = {};
  let result: { success: true; scan: SystemScan } | ToolFailure;
  try {
    const scanPath = path.join(os.homedir(), ".laia-arch", "last-scan.json");
    const raw = fs.readFileSync(scanPath, "utf8");
    const parsed = JSON.parse(raw) as { scan?: SystemScan };
    if (!parsed.scan) {
      result = fail("no se encontró scan en ~/.laia-arch/last-scan.json", false);
    } else {
      result = { success: true, scan: parsed.scan };
    }
  } catch (error) {
    result = fail(`no se pudo leer el último escaneo: ${summarizeExecError(error)}`, true);
  }
  logToolCall("get_system_info", params, result);
  return result;
}

export function checkPortAvailable(port: number):
  | { success: true; available: boolean; process?: string }
  | ToolFailure {
  const params = { port };
  let result: { success: true; available: boolean; process?: string } | ToolFailure;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    result = fail("puerto inválido", false);
    logToolCall("check_port_available", params, result);
    return result;
  }

  try {
    const stdout = execSync(`ss -tlnp 2>/dev/null | grep -E '[:.]${port}\\s' || true`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!stdout) {
      result = { success: true, available: true };
    } else {
      const processMatch = stdout.match(/users:\(\("([^"]+)"/);
      result = {
        success: true,
        available: false,
        ...(processMatch?.[1] ? { process: processMatch[1] } : {}),
      };
    }
  } catch (error) {
    result = fail(`no se pudo comprobar el puerto: ${summarizeExecError(error)}`, true);
  }

  logToolCall("check_port_available", params, result);
  return result;
}

export function checkServiceStatus(service: string):
  | { success: true; status: "active" | "inactive" | "not-installed" }
  | ToolFailure {
  const params = { service };
  let result: { success: true; status: "active" | "inactive" | "not-installed" } | ToolFailure;
  const normalized = service.trim();
  if (!normalized) {
    result = fail("nombre de servicio vacío", false);
    logToolCall("check_service_status", params, result);
    return result;
  }

  try {
    const active = execSync(`systemctl is-active ${JSON.stringify(normalized)} 2>/dev/null || true`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .toLowerCase();
    if (active === "active") {
      result = { success: true, status: "active" };
    } else if (active === "inactive" || active === "failed" || active === "activating") {
      result = { success: true, status: "inactive" };
    } else {
      const statusOutput = execSync(`systemctl status ${JSON.stringify(normalized)} 2>&1 || true`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).toLowerCase();
      result = {
        success: true,
        status: statusOutput.includes("could not be found") ? "not-installed" : "inactive",
      };
    }
  } catch (error) {
    result = fail(`no se pudo comprobar el servicio: ${summarizeExecError(error)}`, true);
  }

  logToolCall("check_service_status", params, result);
  return result;
}

export function readFile(filePath: string):
  | { success: true; content: string; exists: boolean }
  | ToolFailure {
  const params = { path: filePath };
  let result: { success: true; content: string; exists: boolean } | ToolFailure;
  if (!isAllowedReadPath(filePath)) {
    result = fail("ruta no permitida", false);
    logToolCall("read_file", params, result);
    return result;
  }

  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      result = { success: true, content: "", exists: false };
    } else {
      result = {
        success: true,
        content: fs.readFileSync(resolved, "utf8"),
        exists: true,
      };
    }
  } catch (error) {
    result = fail(`no se pudo leer el archivo: ${summarizeExecError(error)}`, true);
  }

  logToolCall("read_file", params, result);
  return result;
}
