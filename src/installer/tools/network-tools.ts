import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

function classifyNetworkError(message: string): ToolFailure {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("permission denied") ||
    normalized.includes("invalid") ||
    normalized.includes("not found")
  ) {
    return fail(message, false);
  }
  return fail(message, true);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "laia-network-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function configureHostname(
  hostname: string,
  domain: string,
): { success: true } | ToolFailure {
  const params = { hostname, domain };
  let result: { success: true } | ToolFailure;
  if (!/^[a-z0-9-]+$/i.test(hostname)) {
    result = fail("hostname inválido", false);
    logToolCall("configure_hostname", params, result);
    return result;
  }
  if (!/^[a-z0-9.-]+$/i.test(domain)) {
    result = fail("dominio inválido", false);
    logToolCall("configure_hostname", params, result);
    return result;
  }

  try {
    execSync(`sudo hostnamectl set-hostname ${shellQuote(hostname)}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const fqdn = `${hostname}.${domain}`;
    withTempDir((dir) => {
      const tempHosts = path.join(dir, "hosts");
      execSync(`sudo cp /etc/hosts ${shellQuote(tempHosts)}`, { stdio: "ignore" });
      const existing = fs.readFileSync(tempHosts, "utf8");
      const cleaned = existing
        .split("\n")
        .filter((line) => !line.includes(` ${hostname}`) && !line.includes(` ${fqdn}`))
        .join("\n")
        .replace(/\n*$/, "\n");
      fs.writeFileSync(tempHosts, `${cleaned}127.0.1.1 ${fqdn} ${hostname}\n`, "utf8");
      execSync(`sudo cp ${shellQuote(tempHosts)} /etc/hosts`, { stdio: "ignore" });
    });
    result = { success: true };
  } catch (error) {
    result = classifyNetworkError(summarizeExecError(error));
  }

  logToolCall("configure_hostname", params, result);
  return result;
}

export function configureWireguardPeer(params: {
  username: string;
  clientIp: string;
  serverIp: string;
  serverPort: number;
  serverPublicKey: string;
}): { success: true; configPath: string; qrAvailable: boolean } | ToolFailure {
  let result: { success: true; configPath: string; qrAvailable: boolean } | ToolFailure;
  if (!/^[a-z]+(?:\.[a-z]+)+$/.test(params.username)) {
    result = fail("username inválido: debe tener formato nombre.apellido", false);
    logToolCall("configure_wireguard_peer", params, result);
    return result;
  }
  if (!Number.isInteger(params.serverPort) || params.serverPort < 1 || params.serverPort > 65535) {
    result = fail("serverPort fuera de rango", false);
    logToolCall("configure_wireguard_peer", params, result);
    return result;
  }

  try {
    result = withTempDir((dir) => {
      const privateKey = execSync("wg genkey", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      const publicKey = execSync("wg pubkey", {
        input: `${privateKey}\n`,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      const peersDir = "/etc/wireguard/peers";
      const configPath = `${peersDir}/${params.username}.conf`;
      const clientConfig = [
        "[Interface]",
        `Address = ${params.clientIp}/32`,
        `PrivateKey = ${privateKey}`,
        "DNS = 1.1.1.1",
        "",
        "[Peer]",
        `PublicKey = ${params.serverPublicKey}`,
        `Endpoint = ${params.serverIp}:${params.serverPort}`,
        "AllowedIPs = 0.0.0.0/0",
        "PersistentKeepalive = 25",
        "",
      ].join("\n");
      const tempConfig = path.join(dir, `${params.username}.conf`);
      fs.writeFileSync(tempConfig, clientConfig, { mode: 0o600 });
      execSync(`sudo install -d -m 0700 ${shellQuote(peersDir)}`, { stdio: "ignore" });
      execSync(`sudo cp ${shellQuote(tempConfig)} ${shellQuote(configPath)}`, { stdio: "ignore" });
      const peerBlock = [
        "",
        `[Peer] # ${params.username}`,
        `PublicKey = ${publicKey}`,
        `AllowedIPs = ${params.clientIp}/32`,
        "",
      ].join("\n");
      execSync(
        `sudo sh -c "grep -q ${shellQuote(`# ${params.username}`)} /etc/wireguard/wg0.conf || printf '%s\n' ${shellQuote(peerBlock)} >> /etc/wireguard/wg0.conf"`,
        { stdio: "ignore" },
      );
      const qrAvailable =
        execSync("command -v qrencode >/dev/null 2>&1 && echo yes || true", {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim() === "yes";
      if (qrAvailable) {
        execSync(`qrencode -t ansiutf8 < ${shellQuote(tempConfig)} >/dev/null`, {
          stdio: ["ignore", "ignore", "ignore"],
        });
      }
      return { success: true, configPath, qrAvailable };
    });
  } catch (error) {
    result = classifyNetworkError(summarizeExecError(error));
  }

  logToolCall("configure_wireguard_peer", params, result);
  return result;
}

export function addDnsRecord(
  name: string,
  ip: string,
  domain: string,
): { success: true } | ToolFailure {
  const params = { name, ip, domain };
  let result: { success: true } | ToolFailure;
  if (!/^[a-z0-9-]+$/i.test(name)) {
    result = fail("nombre de registro DNS inválido", false);
    logToolCall("add_dns_record", params, result);
    return result;
  }
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    result = fail("IP inválida", false);
    logToolCall("add_dns_record", params, result);
    return result;
  }
  if (!/^[a-z0-9.-]+$/i.test(domain)) {
    result = fail("dominio inválido", false);
    logToolCall("add_dns_record", params, result);
    return result;
  }

  try {
    const zoneFile = `/etc/bind/db.${domain}`;
    const recordLine = `${name}    IN    A    ${ip}`;
    execSync(
      `sudo sh -c "grep -q ${shellQuote(recordLine)} ${shellQuote(zoneFile)} || printf '%s\n' ${shellQuote(recordLine)} >> ${shellQuote(zoneFile)}"`,
      { stdio: "ignore" },
    );
    execSync("sudo rndc reload || sudo systemctl reload bind9 || sudo systemctl reload named", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    result = { success: true };
  } catch (error) {
    result = classifyNetworkError(summarizeExecError(error));
  }

  logToolCall("add_dns_record", params, result);
  return result;
}
