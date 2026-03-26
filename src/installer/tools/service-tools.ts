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

export async function installPackage(
  packages: string[],
): Promise<{ success: true; output: string } | ToolFailure> {
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
        decision === "timeout"
          ? "timeout esperando aprobación"
          : "instalación rechazada por el usuario",
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

export function enableService(service: string): { success: true } | ToolFailure {
  const params = { service };
  let result: { success: true } | ToolFailure;
  const normalized = service.trim();
  if (!normalized || !isSafeServiceName(normalized)) {
    result = fail("nombre de servicio no permitido", false);
    logToolCall("enable_service", params, result);
    return result;
  }

  try {
    execSync(
      `sudo systemctl enable ${JSON.stringify(normalized)} && sudo systemctl start ${JSON.stringify(normalized)}`,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
      shell: "/bin/bash",
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
        shell: "/bin/bash",
      });
      fs.rmSync(tempPath, { force: true });
    }

    const verify = execSync(`sysctl ${JSON.stringify(params.key)}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: "/bin/bash",
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

/**
 * Repara el gestor de paquetes dpkg cuando queda en estado inconsistente.
 * Ejecuta: dpkg --configure -a → apt-get -f install → apt-get autoremove.
 * Requiere aprobación del administrador antes de ejecutar.
 */
export async function repairDpkg(): Promise<{ success: true; output: string } | ToolFailure> {
  const step: InstallStep = {
    id: `repair-dpkg-${Date.now()}`,
    phase: 0,
    description:
      "Reparar dpkg: completar instalaciones interrumpidas y resolver dependencias rotas",
    commands: [
      "sudo dpkg --configure -a",
      "sudo apt-get -f install -y",
      "sudo apt-get autoremove -y",
    ],
    requiresApproval: true,
  };

  let result: { success: true; output: string } | ToolFailure;
  try {
    const approval = await requestApproval(step, 120);
    const decision = await waitForApproval(approval);
    if (decision !== "approved") {
      result = fail(
        decision === "timeout"
          ? "timeout esperando aprobación"
          : "reparación rechazada por el usuario",
        false,
      );
      logToolCall("repair_dpkg", {}, result);
      return result;
    }

    const env = { ...process.env, DEBIAN_FRONTEND: "noninteractive" };
    const out1 = execSync("sudo dpkg --configure -a", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    const out2 = execSync("sudo apt-get -f install -y", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    const out3 = execSync("sudo apt-get autoremove -y", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    result = { success: true, output: [out1, out2, out3].join("\n---\n").trim() };
  } catch (error) {
    result = classifyCommandFailure(summarizeExecError(error));
  }

  logToolCall("repair_dpkg", {}, result);
  return result;
}

/**
 * Reinicia un servicio systemd.
 * Requiere aprobación del administrador antes de ejecutar.
 */
export async function restartService(service: string): Promise<{ success: true } | ToolFailure> {
  const params = { service };
  const normalized = service.trim();
  let result: { success: true } | ToolFailure;

  if (!normalized || !isSafeServiceName(normalized)) {
    result = fail("nombre de servicio no permitido", false);
    logToolCall("restart_service", params, result);
    return result;
  }

  const step: InstallStep = {
    id: `restart-service-${Date.now()}`,
    phase: 0,
    description: `Reiniciar servicio: ${normalized}`,
    commands: [`sudo systemctl restart ${normalized}`],
    requiresApproval: true,
  };

  try {
    const approval = await requestApproval(step, 60);
    const decision = await waitForApproval(approval);
    if (decision !== "approved") {
      result = fail(
        decision === "timeout"
          ? "timeout esperando aprobación"
          : "reinicio rechazado por el usuario",
        false,
      );
      logToolCall("restart_service", params, result);
      return result;
    }

    execSync(`sudo systemctl restart ${JSON.stringify(normalized)}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    result = { success: true };
  } catch (error) {
    result = classifyCommandFailure(summarizeExecError(error));
  }

  logToolCall("restart_service", params, result);
  return result;
}

/**
 * Lee las últimas líneas del log de un servicio systemd via journalctl.
 * Solo lectura — no requiere aprobación.
 */
export function readLogs(
  service: string,
  lines = 60,
): { success: true; output: string } | ToolFailure {
  const params = { service, lines };
  const normalized = service.trim();
  let result: { success: true; output: string } | ToolFailure;

  if (!normalized || !isSafeServiceName(normalized)) {
    result = fail("nombre de servicio no permitido", false);
    logToolCall("read_logs", params, result);
    return result;
  }

  const safeLines = Math.min(Math.max(1, Math.floor(lines)), 300);

  try {
    const output = execSync(
      `journalctl -u ${JSON.stringify(normalized)} --no-pager -n ${safeLines}`,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    result = { success: true, output: output.trim() };
  } catch (error) {
    result = fail(summarizeExecError(error), true);
  }

  logToolCall("read_logs", params, result);
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
        shell: "/bin/bash",
      }).trim();

    execSync(
      `curl -fsSL ${JSON.stringify(params.gpgKeyUrl)} | sudo gpg --dearmor -o ${JSON.stringify(keyringPath)}`,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: "/bin/bash",
      },
    );

    const repoLine =
      `deb [arch=$(dpkg --print-architecture) signed-by=${keyringPath}] ` +
      `${params.repoUrl} ${distribution} stable`;
    execSync(
      `printf '%s\\n' ${JSON.stringify(repoLine)} | sudo tee ${JSON.stringify(listPath)} > /dev/null`,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: "/bin/bash",
      },
    );

    execSync("sudo apt-get update", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: "/bin/bash",
    });

    result = { success: true, retryable: false };
  } catch (error) {
    try {
      execSync(`sudo rm -f ${JSON.stringify(keyringPath)} ${JSON.stringify(listPath)}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: "/bin/bash",
      });
    } catch {
      // Best effort rollback only.
    }
    result = fail(`no se pudo añadir el repositorio apt: ${summarizeExecError(error)}`, true);
  }

  logToolCall("add_apt_repository", safeParams, result);
  return result;
}

/**
 * Ejecuta un comando de solo lectura/diagnóstico sin sudo y sin aprobación.
 * Úsalo para comandos que no modifican el sistema: named-checkconf, dpkg -l, grep, etc.
 */
export function runDiagnostic(command: string): { success: true; output: string } | ToolFailure {
  const params = { command };
  let result: { success: true; output: string } | ToolFailure;

  if (!command || typeof command !== "string" || !command.trim()) {
    result = fail("comando vacío", false);
    logToolCall("run_diagnostic", params, result);
    return result;
  }

  try {
    const output = execSync(command, {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    result = { success: true, output: output.slice(0, 4000) };
  } catch (error) {
    // Muchos comandos de diagnóstico devuelven exit code != 0 (grep sin resultado, etc.)
    const msg = summarizeExecError(error);
    const stdout = (error as { stdout?: string }).stdout ?? "";
    result = stdout.trim() ? { success: true, output: stdout.slice(0, 4000) } : fail(msg, false);
  }

  logToolCall("run_diagnostic", params, result);
  return result;
}

// Patrones de comandos bloqueados por seguridad (destructivos irreversibles)
const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+-rf\s+\/(?!\s|$)/,
  /mkfs\./,
  /dd\s+if=/,
  />\s*\/dev\/[sh]d/,
  /shred\s/,
];

/**
 * Ejecuta un comando de sistema con sudo. Solo disponible en modo rescate.
 * Requiere aprobación del administrador antes de ejecutarse.
 */
export function runCommand(command: string): { success: true; output: string } | ToolFailure {
  const params = { command };
  let result: { success: true; output: string } | ToolFailure;

  if (!command || typeof command !== "string" || !command.trim()) {
    result = fail("comando vacío", false);
    logToolCall("run_command", params, result);
    return result;
  }

  if (BLOCKED_COMMAND_PATTERNS.some((re) => re.test(command))) {
    result = fail("comando bloqueado por política de seguridad", false);
    logToolCall("run_command", params, result);
    return result;
  }

  try {
    const output = execSync(`sudo bash -c ${JSON.stringify(command)}`, {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    result = { success: true, output: output.slice(0, 4000) };
  } catch (error) {
    result = classifyCommandFailure(summarizeExecError(error));
  }

  logToolCall("run_command", params, result);
  return result;
}
