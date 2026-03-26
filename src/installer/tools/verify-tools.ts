import { execSync } from "node:child_process";
import fs from "node:fs";
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

function execWithSudoFallback(command: string): string {
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: "/bin/bash",
    });
  } catch (error) {
    try {
      return execSync(`sudo -n bash -lc ${JSON.stringify(command)}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: "/bin/bash",
      });
    } catch {
      throw error;
    }
  }
}

function serviceActive(service: string): boolean {
  const status = execSync(`systemctl is-active ${JSON.stringify(service)} 2>/dev/null || true`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim()
    .toLowerCase();
  return status === "active";
}

export function verifyDnsResolution(
  hostname: string,
): { success: true; resolves: boolean; ip?: string } | ToolFailure {
  const params = { hostname };
  let result: { success: true; resolves: boolean; ip?: string } | ToolFailure;
  if (!/^[a-z0-9.-]+$/i.test(hostname)) {
    result = fail("hostname inválido", false);
    logToolCall("verify_dns_resolution", params, result);
    return result;
  }

  try {
    const output = execSync(`dig +short ${JSON.stringify(hostname)} @localhost`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^\d+\.\d+\.\d+\.\d+$/.test(line));
    result = output
      ? { success: true, resolves: true, ip: output }
      : { success: true, resolves: false };
  } catch (error) {
    result = fail(`no se pudo verificar DNS: ${summarizeExecError(error)}`, true);
  }

  logToolCall("verify_dns_resolution", params, result);
  return result;
}

export function verifyServiceChain():
  | {
      success: true;
      dns: boolean;
      ldap: boolean;
      ldap_responds: boolean;
      samba: boolean;
      samba_shares: number;
      docker: boolean;
      docker_operational: boolean;
      nginx: boolean;
      wireguard: boolean;
      cockpit: boolean;
      backup_script: boolean;
    }
  | ToolFailure {
  const params = {};
  let result:
    | {
        success: true;
        dns: boolean;
        ldap: boolean;
        ldap_responds: boolean;
        samba: boolean;
        samba_shares: number;
        docker: boolean;
        docker_operational: boolean;
        nginx: boolean;
        wireguard: boolean;
        cockpit: boolean;
        backup_script: boolean;
      }
    | ToolFailure;
  try {
    let ldapResponds = false;
    try {
      execSync('ldapsearch -x -H ldap://localhost -b "" -s base', {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: "/bin/bash",
      });
      ldapResponds = true;
    } catch {
      ldapResponds = false;
    }

    let sambaShares = 0;
    try {
      const smbList = execSync("smbclient -L localhost -N 2>/dev/null", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: "/bin/bash",
      });
      sambaShares = smbList
        .split("\n")
        .map((line) => line.trim())
        .filter(
          (line) =>
            line &&
            !line.startsWith("Sharename") &&
            !line.startsWith("Server") &&
            !line.startsWith("Workgroup"),
        )
        .filter((line) => /\s+Disk(\s|$)/.test(line)).length;
    } catch {
      sambaShares = 0;
    }

    let dockerOperational = false;
    try {
      execWithSudoFallback("docker info 2>/dev/null");
      dockerOperational = true;
    } catch {
      dockerOperational = false;
    }

    let backupScript = false;
    try {
      fs.accessSync("/usr/local/bin/backup-laia.sh", fs.constants.X_OK);
      backupScript = true;
    } catch {
      try {
        fs.accessSync("/usr/local/bin/laia-arch-backup", fs.constants.X_OK);
        backupScript = true;
      } catch {
        backupScript = false;
      }
    }

    result = {
      success: true,
      dns: serviceActive("bind9") || serviceActive("named"),
      ldap: serviceActive("slapd"),
      ldap_responds: ldapResponds,
      samba: serviceActive("smbd") && serviceActive("nmbd"),
      samba_shares: sambaShares,
      docker: serviceActive("docker"),
      docker_operational: dockerOperational,
      nginx: serviceActive("nginx"),
      wireguard: serviceActive("wg-quick@wg0"),
      cockpit: serviceActive("cockpit") || serviceActive("cockpit.socket"),
      backup_script: backupScript,
    };
  } catch (error) {
    result = fail(
      `no se pudo verificar la cadena de servicios: ${summarizeExecError(error)}`,
      true,
    );
  }

  logToolCall("verify_service_chain", params, result);
  return result;
}

function resolveBackupCommand(): { command: string; logPath: string } | null {
  const scriptPath = "/usr/local/bin/laia-arch-backup";
  if (fs.existsSync(scriptPath)) {
    return { command: scriptPath, logPath: scriptPath };
  }
  const cronPath = "/etc/cron.d/laia-arch-backup";
  if (!fs.existsSync(cronPath)) {
    return null;
  }
  const cronLine = fs
    .readFileSync(cronPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  if (!cronLine) {
    return null;
  }
  const parts = cronLine.split(/\s+/);
  if (parts.length < 7) {
    return null;
  }
  return { command: parts.slice(6).join(" "), logPath: cronPath };
}

export function runBackupTest(): { success: true; sizeKb: number; logPath: string } | ToolFailure {
  const params = {};
  let result: { success: true; sizeKb: number; logPath: string } | ToolFailure;
  try {
    const resolved = resolveBackupCommand();
    if (!resolved) {
      result = fail("no se encontró script o cron de backup", false);
      logToolCall("run_backup_test", params, result);
      return result;
    }
    execWithSudoFallback(resolved.command);
    const sizeOutput = execWithSudoFallback(
      "du -sk /var/backups/laia-arch 2>/dev/null | awk '{print $1}' || echo 0",
    ).trim();
    result = {
      success: true,
      sizeKb: Number.parseInt(sizeOutput, 10) || 0,
      logPath: resolved.logPath,
    };
  } catch (error) {
    result = fail(`no se pudo ejecutar el backup: ${summarizeExecError(error)}`, true);
  }

  logToolCall("run_backup_test", params, result);
  return result;
}
