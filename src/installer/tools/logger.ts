import { execFileSync } from "node:child_process";
import fs from "node:fs";

const LOG_DIR = "/var/log/laia-arch";
const LOG_FILE = `${LOG_DIR}/tools.log`;
const SENSITIVE_KEY_RE = /(password|key|token|secret)/i;

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        SENSITIVE_KEY_RE.test(key) ? "[redacted]" : sanitizeValue(entryValue),
      ]),
    );
  }
  return value;
}

function stringifyForLog(value: unknown): string {
  try {
    const rendered = JSON.stringify(sanitizeValue(value));
    if (!rendered) {
      return "null";
    }
    return rendered.length > 600 ? `${rendered.slice(0, 597)}...` : rendered;
  } catch {
    return String(value);
  }
}

function appendLine(line: string): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${line}\n`, "utf8");
    return;
  } catch {
    // Fall through to sudo-assisted best effort logging.
  }

  try {
    execFileSync("sudo", ["-n", "mkdir", "-p", LOG_DIR], { stdio: "ignore" });
    execFileSync("sudo", ["-n", "touch", LOG_FILE], { stdio: "ignore" });
    execFileSync("sudo", ["-n", "sh", "-c", `printf '%s\n' "$1" >> "${LOG_FILE}"`, "sh", line], {
      stdio: "ignore",
    });
  } catch {
    // Logging must never break the tool execution path.
  }
}

export function logToolCall(
  toolName: string,
  params: Record<string, unknown>,
  result: unknown,
): void {
  const timestamp = new Date().toISOString();
  const renderedParams = stringifyForLog(params);
  const renderedResult = stringifyForLog(result);
  appendLine(`[${timestamp}] ${toolName}(${renderedParams}) → ${renderedResult}`);
}
