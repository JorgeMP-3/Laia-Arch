import { execFileSync, execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { retrieveCredential } from "../credential-manager.js";
import { logToolCall } from "./logger.js";
import { INVALID_INSTALLER_USERNAME_MESSAGE, isValidInstallerUsername } from "./username-policy.js";

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

function classifySambaError(message: string): ToolFailure {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("already exists") ||
    normalized.includes("invalid") ||
    normalized.includes("permission denied")
  ) {
    return fail(message, false);
  }
  return fail(message, true);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function createSambaShare(params: {
  name: string;
  path: string;
  validUsers?: string;
  readOnly: boolean;
  browseable: boolean;
}): { success: true } | ToolFailure {
  let result: { success: true } | ToolFailure;
  if (!/^[A-Za-z0-9._-]+$/.test(params.name)) {
    result = fail("nombre de share inválido", false);
    logToolCall("create_samba_share", params, result);
    return result;
  }
  const targetPath = path.posix.join("/srv/samba", params.name);
  if (params.path && path.posix.normalize(params.path) !== targetPath) {
    result = fail("la ruta del share debe estar dentro de /srv/samba/NAME", false);
    logToolCall("create_samba_share", params, result);
    return result;
  }
  if (params.validUsers && !/^[@A-Za-z0-9._,\s-]+$/.test(params.validUsers)) {
    result = fail("validUsers contiene caracteres no permitidos", false);
    logToolCall("create_samba_share", params, result);
    return result;
  }

  try {
    execFileSync("sudo", ["install", "-d", "-m", "2770", targetPath], { stdio: "ignore" });
    const smbConf = "/etc/samba/smb.conf";
    const existing = execFileSync("sudo", ["cat", smbConf], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const sectionHeader = `[${params.name}]`;
    if (!existing.includes(sectionHeader)) {
      const lines = [
        sectionHeader,
        `path = ${targetPath}`,
        `browseable = ${params.browseable ? "yes" : "no"}`,
        `read only = ${params.readOnly ? "yes" : "no"}`,
        ...(params.validUsers ? [`valid users = ${params.validUsers}`] : []),
        "",
      ].join("\n");
      execFileSync(
        "sudo",
        ["sh", "-c", `printf '%s\n' ${shellQuote(lines)} >> ${shellQuote(smbConf)}`],
        {
          stdio: "ignore",
        },
      );
    }
    result = { success: true };
  } catch (error) {
    result = classifySambaError(summarizeExecError(error));
  }

  logToolCall("create_samba_share", params, result);
  return result;
}

export async function registerSambaUser(
  username: string,
  passwordId: string,
): Promise<{ success: true } | ToolFailure> {
  const params = { username, passwordId };
  let result: { success: true } | ToolFailure;
  if (!isValidInstallerUsername(username)) {
    result = fail(INVALID_INSTALLER_USERNAME_MESSAGE, false);
    logToolCall("register_samba_user", params, result);
    return result;
  }

  try {
    const password = await retrieveCredential(passwordId);
    const proc = spawnSync("sudo", ["smbpasswd", "-s", "-a", username], {
      input: `${password}\n${password}\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (proc.status !== 0) {
      throw new Error(proc.stderr || proc.stdout || `smbpasswd falló (${proc.status})`);
    }
    result = { success: true };
  } catch (error) {
    result = classifySambaError(summarizeExecError(error));
  }

  logToolCall("register_samba_user", params, result);
  return result;
}

export function verifySambaShare(
  share: string,
): { success: true; accessible: boolean } | ToolFailure {
  const params = { share };
  let result: { success: true; accessible: boolean } | ToolFailure;
  if (!/^[A-Za-z0-9._-]+$/.test(share)) {
    result = fail("nombre de share inválido", false);
    logToolCall("verify_samba_share", params, result);
    return result;
  }

  try {
    execSync(`smbclient //localhost/${share} -N -c ls`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    result = { success: true, accessible: true };
  } catch (error) {
    const message = summarizeExecError(error);
    if (message.toLowerCase().includes("nt_status")) {
      result = { success: true, accessible: false };
    } else {
      result = classifySambaError(message);
    }
  }

  logToolCall("verify_samba_share", params, result);
  return result;
}
