import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

function isSafeSysctlKey(value: string): boolean {
  return [
    "net.ipv4.ip_forward",
    "net.ipv6.conf.all.forwarding",
    "net.ipv4.conf.all.rp_filter",
    "net.core.rmem_max",
    "net.core.wmem_max",
    "vm.swappiness",
  ].includes(value);
}

function isSafeRepositoryFileName(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function isSafeRepositoryUrl(value: string): boolean {
  return /^https:\/\/[A-Za-z0-9./:_-]+$/.test(value);
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

export function configureSysctl(params: {
  key: string;
  value: string;
  persistent?: boolean;
}): { success: true; retryable: boolean } | ToolFailure {
  const safeParams = {
    key: params.key,
    value: params.value,
    persistent: params.persistent ?? false,
  };
  let result: { success: true; retryable: boolean } | ToolFailure;

  if (!isSafeSysctlKey(params.key)) {
    result = fail("parámetro sysctl no permitido", false);
    logToolCall("configure_sysctl", safeParams, result);
    return result;
  }

  try {
    execSync(`sudo sysctl -w ${JSON.stringify(params.key)}=${JSON.stringify(params.value)}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    if (params.persistent) {
      const sysctlPath = "/etc/sysctl.conf";
      const desiredLine = `${params.key}=${params.value}`;
      const current = fs.existsSync(sysctlPath) ? fs.readFileSync(sysctlPath, "utf8") : "";
      const lines = current
        .split("\n")
        .filter((line) => !line.trim().startsWith(`${params.key}=`) && line.trim() !== desiredLine);
      lines.push(desiredLine);
      const content = `${lines.filter(Boolean).join("\n")}\n`;
      const tempPath = path.join("/tmp", `laia-arch-sysctl-${Date.now()}.conf`);
      fs.writeFileSync(tempPath, content, "utf8");
      execSync(`sudo install -m 644 ${JSON.stringify(tempPath)} ${JSON.stringify(sysctlPath)}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });
      fs.rmSync(tempPath, { force: true });
    }

    const verify = execSync(`sysctl ${JSON.stringify(params.key)}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    }).trim();

    if (!verify.endsWith(`= ${params.value}`) && !verify.endsWith(`= ${Number(params.value)}`)) {
      result = fail(`el valor de sysctl no coincide tras aplicar: ${verify}`, true);
    } else {
      result = { success: true, retryable: false };
    }
  } catch (error) {
    result = classifyCommandFailure(summarizeExecError(error));
  }

  logToolCall("configure_sysctl", safeParams, result);
  return result;
}

export function addAptRepository(params: {
  repoUrl: string;
  gpgKeyUrl: string;
  listFileName: string;
  distribution?: string;
}): { success: true; retryable: boolean } | ToolFailure {
  const safeParams = {
    repoUrl: params.repoUrl,
    gpgKeyUrl: params.gpgKeyUrl,
    listFileName: params.listFileName,
    distribution: params.distribution,
  };
  let result: { success: true; retryable: boolean } | ToolFailure;

  if (!isSafeRepositoryUrl(params.repoUrl) || !isSafeRepositoryUrl(params.gpgKeyUrl)) {
    result = fail("URL de repositorio o clave no permitida", false);
    logToolCall("add_apt_repository", safeParams, result);
    return result;
  }
  if (!isSafeRepositoryFileName(params.listFileName)) {
    result = fail("nombre de archivo de repositorio no permitido", false);
    logToolCall("add_apt_repository", safeParams, result);
    return result;
  }

  const baseName = params.listFileName.replace(/\.[^.]+$/, "");
  const keyringPath = `/usr/share/keyrings/${baseName}.gpg`;
  const listPath = `/etc/apt/sources.list.d/${params.listFileName}`;

  try {
    const distribution =
      params.distribution?.trim() ||
      execSync(". /etc/os-release && printf '%s' \"$VERSION_CODENAME\"", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      }).trim();

    execSync(
      `curl -fsSL ${JSON.stringify(params.gpgKeyUrl)} | sudo gpg --dearmor -o ${JSON.stringify(keyringPath)}`,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      },
    );

    const repoLine =
      `deb [arch=$(dpkg --print-architecture) signed-by=${keyringPath}] ` +
      `${params.repoUrl} ${distribution} stable`;
    execSync(`printf '%s\\n' ${JSON.stringify(repoLine)} | sudo tee ${JSON.stringify(listPath)} > /dev/null`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    execSync("sudo apt-get update", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    result = { success: true, retryable: false };
  } catch (error) {
    try {
      execSync(`sudo rm -f ${JSON.stringify(keyringPath)} ${JSON.stringify(listPath)}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });
    } catch {
      // Best effort rollback only.
    }
    result = fail(`no se pudo añadir el repositorio apt: ${summarizeExecError(error)}`, true);
  }

  logToolCall("add_apt_repository", safeParams, result);
  return result;
}
