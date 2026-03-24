// credential-manager.ts — Gestión segura de credenciales generadas durante la instalación
// Las contraseñas se generan aquí, nunca pasan por el contexto de la IA.

import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import { ensureAuthProfileStore } from "../agents/auth-profiles/store.js";
import type { AuthProfileCredential } from "../agents/auth-profiles/types.js";
import { buildApiKeyCredential } from "../plugins/provider-auth-helpers.js";
import { buildTokenProfileId, validateAnthropicSetupToken } from "../plugins/provider-auth-token.js";
import { upsertAuthProfile } from "../agents/auth-profiles/profiles.js";

// ─── Credenciales de IA (usan el sistema de auth-profiles de OpenClaw) ─────────

/**
 * Almacena una API key para un proveedor de IA usando el sistema de auth-profiles
 * de OpenClaw. Escribe en ~/.laia-arch/agents/main/agent/auth-profiles.json,
 * el mismo fichero que lee el Gateway al arrancar.
 * Devuelve el profileId (e.g. "anthropic:default").
 */
export function storeApiKey(provider: string, key: string): string {
  const profileId = buildTokenProfileId({ provider, name: "default" });
  const credential = buildApiKeyCredential(provider, key);
  upsertAuthProfile({ profileId, credential });
  return profileId;
}

/**
 * Almacena un setup-token de Claude Code (tipo TokenCredential).
 * Valida el formato antes de persistir.
 * Devuelve el profileId ("anthropic:default").
 */
export function storeSetupToken(token: string): string {
  const error = validateAnthropicSetupToken(token);
  if (error) {
    throw new Error(error);
  }
  const profileId = buildTokenProfileId({ provider: "anthropic", name: "default" });
  const credential: AuthProfileCredential = {
    type: "token",
    provider: "anthropic",
    token: token.trim(),
  };
  upsertAuthProfile({ profileId, credential });
  return profileId;
}

/**
 * Recupera una credencial de IA por su profileId desde auth-profiles.json.
 */
export function retrieveProfileCredential(profileId: string): AuthProfileCredential {
  const store = ensureAuthProfileStore();
  const credential = store.profiles[profileId];
  if (!credential) {
    throw new Error(
      `Credencial "${profileId}" no encontrada. Ejecuta laia-arch install de nuevo.`,
    );
  }
  return credential;
}

/**
 * Extrae el valor de autenticación (key/token) de una credencial.
 * Útil para construir los headers HTTP de las llamadas a la IA.
 */
export function extractCredentialValue(credential: AuthProfileCredential): string {
  if (credential.type === "api_key") return credential.key ?? "";
  if (credential.type === "token") return credential.token ?? "";
  // oauth: usar access token
  return (credential as { access?: string }).access ?? "";
}

export type CredentialType = "api_key" | "password" | "token";

export interface PasswordOptions {
  length?: number;
  symbols?: boolean;
}

/**
 * Genera una contraseña criptográficamente segura.
 * Esta función NO usa la IA — el valor nunca aparece en el contexto del modelo.
 */
export function generatePassword(options: PasswordOptions = {}): string {
  const { length = 24, symbols = true } = options;
  const alpha = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const syms = symbols ? "!@#$%^&*()_+-=[]{}|;:,.<>?" : "";
  const charset = alpha + digits + syms;

  // Usamos el doble de bytes para evitar bias al hacer módulo
  const bytes = crypto.randomBytes(length * 2);
  let password = "";
  for (let i = 0; i < bytes.length && password.length < length; i++) {
    const idx = bytes[i] % charset.length;
    password += charset[idx];
  }
  return password;
}

/**
 * Almacena una credencial en el keychain del sistema.
 * En Linux: secret-tool (GNOME Keyring). En macOS: security.
 * Fallback: archivo con permisos 600 en ~/.laia-arch/credentials/
 * Devuelve el ID de la credencial almacenada.
 */
export async function storeCredential(
  id: string,
  _type: CredentialType,
  value: string,
): Promise<string> {
  const platform = os.platform();

  try {
    if (platform === "linux") {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("secret-tool", [
          "store",
          "--label",
          `Laia Arch — ${id}`,
          "service",
          "laia-arch",
          "key",
          id,
        ]);
        proc.stdin.write(value);
        proc.stdin.end();
        proc.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`secret-tool falló (código ${code})`)),
        );
        proc.on("error", reject);
      });
    } else if (platform === "darwin") {
      // -U actualiza si ya existe
      execSync(`security add-generic-password -a laia-arch -s "${id}" -U -w`, {
        input: value,
        stdio: ["pipe", "ignore", "ignore"],
      });
    } else {
      throw new Error("plataforma no soportada");
    }
  } catch {
    // Fallback: archivo protegido
    const credDir = `${os.homedir()}/.laia-arch/credentials`;
    fs.mkdirSync(credDir, { recursive: true, mode: 0o700 });
    const credFile = `${credDir}/.${id}`;
    fs.writeFileSync(credFile, value, { mode: 0o600 });
    console.warn(
      `  Aviso: keychain no disponible. Credencial guardada en archivo protegido (600): ${credFile}`,
    );
  }

  return id;
}

/**
 * Recupera una credencial almacenada por su ID.
 * Intenta primero el keychain del sistema y luego el archivo de fallback.
 */
export async function retrieveCredential(id: string): Promise<string> {
  const platform = os.platform();

  try {
    if (platform === "linux") {
      const result = execSync(`secret-tool lookup service laia-arch key "${id}"`, {
        stdio: ["pipe", "pipe", "ignore"],
      });
      return result.toString().trim();
    } else if (platform === "darwin") {
      const result = execSync(`security find-generic-password -a laia-arch -s "${id}" -w`, {
        stdio: ["pipe", "pipe", "ignore"],
      });
      return result.toString().trim();
    }
  } catch {
    // fall through to file fallback
  }

  try {
    const credFile = `${os.homedir()}/.laia-arch/credentials/.${id}`;
    return fs.readFileSync(credFile, "utf8").trim();
  } catch {
    throw new Error(
      `Credencial "${id}" no encontrada. Puede que el instalador no haya completado correctamente.`,
    );
  }
}

/**
 * Genera una credencial segura, la muestra al usuario una sola vez,
 * la almacena en el keychain y destruye el valor de memoria.
 * Devuelve el ID de la credencial almacenada.
 */
export async function provisionCredential(
  id: string,
  label: string,
  options: PasswordOptions = {},
): Promise<string> {
  let password = generatePassword(options);

  console.log(`\n  Credencial generada — ${label}`);
  console.log(`  ID:        ${id}`);
  console.log(`  Contraseña: \x1b[1m${password}\x1b[0m`);
  console.log("  ⚠  Guarda esta contraseña ahora. No se volverá a mostrar.");

  await storeCredential(id, "password", password);

  // Destruir el valor de la memoria inmediatamente
  password = password.replace(/./g, "\0");
  password = "";

  return id;
}
