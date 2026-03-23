// bootstrap.ts — Fase 0: Configuración del proveedor IA antes del instalador conversacional

import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as readline from "node:readline";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import type { AiProvider, AuthMethod, BootstrapResult } from "./types.js";

const SUPPORTED_PROVIDERS: AiProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
    authMethods: ["API key", "Setup-token de Claude Code"],
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    models: ["gpt-4o", "gpt-4o-mini"],
    authMethods: ["API key", "OAuth Codex (suscripción)"],
  },
  {
    id: "openrouter",
    name: "OpenRouter (multi-modelo)",
    models: ["claude-sonnet-4-5", "gpt-4o", "gemini-2.0-flash", "mistral-large", "llama-3.3-70b"],
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    models: ["llama3.1", "mistral", "qwen2.5", "phi3"],
  },
  {
    id: "openai-compatible",
    name: "Compatible OpenAI (LM Studio, vLLM...)",
    models: [],
  },
];

// OpenAI OAuth endpoints para el flujo Codex
const OPENAI_OAUTH_CLIENT_ID = "app_01JYXNZS89AZ3XKCGSZAHSRPN8";
const OPENAI_OAUTH_REDIRECT_URI = "http://127.0.0.1:1455/auth/callback";
const OPENAI_AUTH_URL = "https://auth.openai.com/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";

// ─── Almacenamiento seguro ────────────────────────────────────────────────────

async function storeCredential(keyId: string, key: string): Promise<void> {
  const platform = os.platform();
  try {
    if (platform === "linux") {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("secret-tool", [
          "store",
          "--label",
          `Laia Arch credential (${keyId})`,
          "service",
          "laia-arch",
          "key",
          keyId,
        ]);
        proc.stdin.write(key);
        proc.stdin.end();
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`secret-tool failed with code ${code}`));
        });
        proc.on("error", reject);
      });
    } else if (platform === "darwin") {
      execSync(`security add-generic-password -a laia-arch -s ${keyId} -w`, {
        input: key,
        stdio: ["pipe", "ignore", "ignore"],
      });
    } else {
      throw new Error("unsupported platform");
    }
  } catch {
    // Fallback: archivo con permisos 600
    const configDir = `${os.homedir()}/.laia-arch`;
    fs.mkdirSync(configDir, { recursive: true });
    const keyFile = `${configDir}/.${keyId}`;
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
    console.warn(
      "  Aviso: keychain no disponible. La credencial se guardó en archivo protegido (600).",
    );
  }
}

async function storeKeySecurely(providerId: string, key: string): Promise<string> {
  const keyId = `laia-arch-${providerId}-api-key`;
  await storeCredential(keyId, key);
  return keyId;
}

export function retrieveKey(keyId: string): string {
  const platform = os.platform();

  try {
    if (platform === "linux") {
      return execSync(`secret-tool lookup service laia-arch key ${keyId}`, {
        stdio: ["pipe", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } else if (platform === "darwin") {
      return execSync(`security find-generic-password -a laia-arch -s ${keyId} -w`, {
        stdio: ["pipe", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } else {
      const keyFile = `${os.homedir()}/.laia-arch/.${keyId}`;
      return fs.readFileSync(keyFile, "utf8").trim();
    }
  } catch {
    // Intentar fallback de archivo independientemente de la plataforma
    try {
      const keyFile = `${os.homedir()}/.laia-arch/.${keyId}`;
      return fs.readFileSync(keyFile, "utf8").trim();
    } catch {
      throw new Error(
        `No se pudo recuperar la credencial: ${keyId}. Ejecuta laia-arch install de nuevo.`,
      );
    }
  }
}

// ─── Validación de credenciales ───────────────────────────────────────────────

async function validateApiKey(
  providerId: string,
  key: string,
  model: string,
  baseUrl?: string,
): Promise<boolean> {
  try {
    if (providerId === "anthropic" || providerId === "anthropic-token") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Responde solo con: OK" }],
        }),
      });
      return response.ok;
    } else if (providerId === "openai") {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Responde solo con: OK" }],
        }),
      });
      return response.ok;
    } else if (providerId === "openrouter") {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": "https://laia-arch.local",
          "X-Title": "Laia Arch",
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Responde solo con: OK" }],
        }),
      });
      return response.ok;
    } else if (providerId === "openai-compatible") {
      const url = `${baseUrl ?? "http://localhost:1234"}/chat/completions`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (key) headers["Authorization"] = `Bearer ${key}`;
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Responde solo con: OK" }],
        }),
      });
      return response.ok;
    } else if (providerId === "ollama") {
      const response = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Helpers de entrada ───────────────────────────────────────────────────────

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const wasRaw = process.stdin.isRaw ?? false;
    let key = "";

    const onData = (char: Buffer) => {
      const c = char.toString();
      if (c === "\r" || c === "\n") {
        process.stdin.setRawMode(wasRaw);
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        process.stdout.write("\n");
        resolve(key);
      } else if (c === "\u0003") {
        // Ctrl-C
        process.stdout.write("\n");
        process.exit(1);
      } else if (c === "\u0008" || c === "\u007f") {
        if (key.length > 0) {
          key = key.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        key += c;
        process.stdout.write("*");
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

// ─── Flujos de autenticación especiales ──────────────────────────────────────

async function handleSetupToken(model: string): Promise<{ credentialId: string }> {
  console.log(
    "\n" +
      t.warn(
        "⚠  Nota: El setup-token usa tu suscripción de Claude. Anthropic ha restringido\n" +
          "   este uso en el pasado. Verifica los términos actuales antes de continuar.",
      ),
  );

  console.log(
    "\n" +
      t.label("Para obtener el token:") +
      "\n" +
      t.dim("  1. Instala Claude Code CLI en cualquier máquina: npm install -g @anthropic-ai/claude-code") +
      "\n" +
      t.dim("  2. Ejecuta: claude setup-token") +
      "\n" +
      t.dim("  3. Copia el token generado y pégalo aquí\n"),
  );

  let token = await askSecret("Setup-token: ");

  if (!token.startsWith("sk-ant-oat-")) {
    throw new Error(
      'El setup-token debe empezar por "sk-ant-oat-". Verifica que has copiado el token completo.',
    );
  }

  console.log("\n" + t.step("Validando el setup-token..."));
  const valid = await validateApiKey("anthropic-token", token, model);

  if (!valid) {
    throw new Error(
      "El setup-token no es válido o ha expirado. Ejecuta claude setup-token de nuevo.",
    );
  }

  console.log("  " + t.good("Setup-token válido\n"));

  const credentialId = "laia-arch-anthropic-setup-token";
  console.log(t.step("Almacenando credenciales en el keychain del sistema..."));
  await storeCredential(credentialId, token);
  token = token.replace(/./g, "\0");

  return { credentialId };
}

async function exchangeOAuthCode(code: string): Promise<string> {
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: OPENAI_OAUTH_CLIENT_ID,
      code,
      grant_type: "authorization_code",
      redirect_uri: OPENAI_OAUTH_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    throw new Error(`Error al intercambiar el código OAuth: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("La respuesta OAuth no incluye access_token.");
  return data.access_token;
}

async function handleOAuthCodex(
  rl: readline.Interface,
  model: string,
): Promise<{ credentialId: string; callbackUrl?: string }> {
  console.log(
    "\n" +
      t.label("OAuth Codex") +
      " — usa tu suscripción de OpenAI en lugar de pagar por API.\n",
  );

  const state = crypto.randomBytes(16).toString("hex");
  const authUrl =
    `${OPENAI_AUTH_URL}?client_id=${OPENAI_OAUTH_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(OPENAI_OAUTH_REDIRECT_URI)}` +
    `&response_type=code&scope=openid%20profile%20email&state=${state}`;

  console.log(t.label("Abre esta URL en tu navegador para autenticarte:"));
  console.log("\n  " + t.brand(authUrl) + "\n");
  console.log(
    t.dim(
      "Cuando completes el login, copia la URL completa a la que te redirige\n" +
        "(empezará por http://127.0.0.1:1455/auth/callback?...)\n" +
        "y pégala aquí:",
    ),
  );

  const callbackUrl = await ask(rl, "\nURL de callback: ");

  let code: string;
  try {
    const url = new URL(callbackUrl.trim());
    const codeParam = url.searchParams.get("code");
    if (!codeParam) throw new Error("no code param");
    const stateParam = url.searchParams.get("state");
    if (stateParam !== state) throw new Error("state mismatch — posible ataque CSRF");
    code = codeParam;
  } catch (err) {
    throw new Error(`URL de callback inválida: ${(err as Error).message}`);
  }

  console.log("\n" + t.step("Intercambiando código por token de acceso..."));
  const accessToken = await exchangeOAuthCode(code);
  console.log("  " + t.good("Token obtenido\n"));

  console.log(t.step("Validando el token con OpenAI..."));
  const valid = await validateApiKey("openai", accessToken, model);
  if (!valid) throw new Error("El token OAuth obtenido no es válido para la API de OpenAI.");
  console.log("  " + t.good("Token válido\n"));

  const credentialId = "laia-arch-openai-oauth-token";
  console.log(t.step("Almacenando credenciales en el keychain del sistema..."));
  await storeCredential(credentialId, accessToken);

  return { credentialId };
}

// ─── Flujo principal ──────────────────────────────────────────────────────────

export async function runBootstrap(): Promise<BootstrapResult> {
  console.log(t.banner());
  console.log(t.dim("  Antes de empezar necesito configurar el modelo de IA.\n"));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // 1. Seleccionar proveedor
  console.log(t.label("Proveedores disponibles:") + "\n");
  SUPPORTED_PROVIDERS.forEach((p, i) => {
    console.log(`  ${t.brand(String(i + 1) + ".")} ${p.name}`);
  });
  console.log();

  const providerChoice = await ask(rl, `Elige el proveedor (1-${SUPPORTED_PROVIDERS.length}): `);
  const providerIndex = parseInt(providerChoice, 10) - 1;

  if (providerIndex < 0 || providerIndex >= SUPPORTED_PROVIDERS.length) {
    rl.close();
    throw new Error("Opcion no valida. Ejecuta laia-arch install de nuevo.");
  }

  const selectedProvider = SUPPORTED_PROVIDERS[providerIndex];

  // 2. Seleccionar método de autenticación (si hay más de uno)
  let authMethod: AuthMethod = "api-key";

  if (selectedProvider.authMethods && selectedProvider.authMethods.length > 1) {
    console.log(`\n${t.label("Métodos de autenticación para")} ${selectedProvider.name}:\n`);
    selectedProvider.authMethods.forEach((m, i) => {
      console.log(`  ${t.brand(String(i + 1) + ".")} ${m}`);
    });
    console.log();

    const authChoice = await ask(
      rl,
      `Elige el método (1-${selectedProvider.authMethods.length}): `,
    );
    const authIndex = parseInt(authChoice, 10) - 1;

    if (authIndex < 0 || authIndex >= selectedProvider.authMethods.length) {
      rl.close();
      throw new Error("Método no válido.");
    }

    const methodName = selectedProvider.authMethods[authIndex];
    if (methodName.startsWith("Setup-token")) {
      authMethod = "setup-token";
    } else if (methodName.startsWith("OAuth")) {
      authMethod = "oauth";
    } else {
      authMethod = "api-key";
    }
  }

  // 3. OpenRouter: mostrar explicación
  if (selectedProvider.id === "openrouter") {
    console.log(
      "\n" +
        t.label("OpenRouter") +
        " da acceso a más de 300 modelos de diferentes proveedores\n" +
        t.dim("con una sola API key. Precios variables según el modelo.\n") +
        t.dim("Obtén tu API key en: ") +
        t.brand("https://openrouter.ai/keys") +
        "\n",
    );
  }

  // 4. Seleccionar modelo
  let selectedModel: string;

  if (selectedProvider.id === "openai-compatible") {
    // Para compatibles, el usuario escribe el nombre del modelo directamente
    selectedModel = (await ask(rl, "Nombre del modelo (ej: llama-3-8b): ")).trim();
    if (!selectedModel) selectedModel = "local-model";
  } else if (selectedProvider.id === "ollama") {
    console.log(`\nModelos conocidos de ${selectedProvider.name}:\n`);
    selectedProvider.models.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m}`);
    });
    console.log(`  ${selectedProvider.models.length + 1}. Otro (introducir nombre)`);
    console.log();

    const modelChoice = await ask(
      rl,
      `Elige el modelo (1-${selectedProvider.models.length + 1}): `,
    );
    const modelIndex = parseInt(modelChoice, 10) - 1;

    if (modelIndex === selectedProvider.models.length) {
      selectedModel = (await ask(rl, "Nombre del modelo instalado en Ollama: ")).trim();
      if (!selectedModel) throw new Error("El nombre del modelo no puede estar vacío.");
    } else if (modelIndex < 0 || modelIndex >= selectedProvider.models.length) {
      rl.close();
      throw new Error("Modelo no válido.");
    } else {
      selectedModel = selectedProvider.models[modelIndex];
    }
  } else {
    console.log(`\nModelos disponibles para ${selectedProvider.name}:\n`);
    selectedProvider.models.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m}`);
    });
    console.log();

    const modelChoice = await ask(rl, `Elige el modelo (1-${selectedProvider.models.length}): `);
    const modelIndex = parseInt(modelChoice, 10) - 1;

    if (modelIndex < 0 || modelIndex >= selectedProvider.models.length) {
      rl.close();
      throw new Error("Modelo no válido.");
    }

    selectedModel = selectedProvider.models[modelIndex];
  }

  // 5. URL base para proveedores compatibles
  let baseUrl: string | undefined = selectedProvider.baseUrl;

  if (selectedProvider.id === "openai-compatible") {
    const input = await ask(rl, "URL base del servidor (ej: http://localhost:1234/v1): ");
    baseUrl = input.trim().replace(/\/$/, "") || "http://localhost:1234/v1";
  }

  // 6. Flujo OAuth: recoger la callback URL antes de cerrar rl
  // (la URL de callback no es un secreto, se puede usar readline)
  let oauthCallbackUrl: string | undefined;
  if (authMethod === "oauth" && selectedProvider.id === "openai") {
    const state = crypto.randomBytes(16).toString("hex");
    const authUrl =
      `${OPENAI_AUTH_URL}?client_id=${OPENAI_OAUTH_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(OPENAI_OAUTH_REDIRECT_URI)}` +
      `&response_type=code&scope=openid%20profile%20email&state=${state}`;

    console.log(
      "\n" +
        t.label("OAuth Codex") +
        " — usa tu suscripción de OpenAI en lugar de pagar por API.\n",
    );
    console.log(t.label("Abre esta URL en tu navegador para autenticarte:"));
    console.log("\n  " + t.brand(authUrl) + "\n");
    console.log(
      t.dim(
        "Cuando completes el login, copia la URL completa a la que te redirige\n" +
          "(empezará por http://127.0.0.1:1455/auth/callback?...)\n" +
          "y pégala aquí:",
      ),
    );
    oauthCallbackUrl = await ask(rl, "\nURL de callback: ");
  }

  rl.close();

  // ─── Ejecutar autenticación ────────────────────────────────────────────────

  let credentialId: string;

  if (selectedProvider.id === "ollama") {
    console.log("\n" + t.step("Verificando servidor Ollama local..."));
    const valid = await validateApiKey("ollama", "", selectedModel);
    if (!valid) {
      throw new Error(
        "No se puede conectar con Ollama en localhost:11434. Asegurate de que Ollama esta instalado y corriendo.",
      );
    }
    console.log("  " + t.good("Ollama disponible\n"));
    credentialId = "laia-arch-ollama-none";
    // No hay key que almacenar, guardamos un placeholder para consistencia
    await storeCredential(credentialId, "ollama-local");
  } else if (authMethod === "setup-token") {
    const result = await handleSetupToken(selectedModel);
    credentialId = result.credentialId;
  } else if (authMethod === "oauth") {
    // Extraer el código de la callback URL recogida con readline
    const callbackUrl = oauthCallbackUrl ?? "";
    let code: string;
    try {
      const url = new URL(callbackUrl.trim());
      const codeParam = url.searchParams.get("code");
      if (!codeParam) throw new Error("no hay parámetro 'code' en la URL");
      code = codeParam;
    } catch (err) {
      throw new Error(`URL de callback inválida: ${(err as Error).message}`);
    }

    console.log("\n" + t.step("Intercambiando código por token de acceso..."));
    const accessToken = await exchangeOAuthCode(code);
    console.log("  " + t.good("Token obtenido\n"));

    console.log(t.step("Validando el token con OpenAI..."));
    const valid = await validateApiKey("openai", accessToken, selectedModel);
    if (!valid) throw new Error("El token OAuth no es válido para la API de OpenAI.");
    console.log("  " + t.good("Token válido\n"));

    credentialId = "laia-arch-openai-oauth-token";
    console.log(t.step("Almacenando credenciales en el keychain del sistema..."));
    await storeCredential(credentialId, accessToken);
  } else {
    // Flujo estándar: API key
    const providerLabel =
      selectedProvider.id === "openrouter" ? "OpenRouter" : selectedProvider.name;
    let apiKey = await askSecret(`\nIntroduce tu API key de ${providerLabel}: `);

    if (!apiKey || apiKey.length < 8) {
      throw new Error("API key demasiado corta. Verifica que la has copiado correctamente.");
    }

    // Validación opcional de formato
    if (selectedProvider.id === "openrouter" && !apiKey.startsWith("sk-or-")) {
      console.warn(
        t.warn('  ⚠ La API key de OpenRouter debería empezar por "sk-or-". Continuando de todas formas...'),
      );
    }

    console.log("\n" + t.step("Validando la API key..."));
    const valid = await validateApiKey(selectedProvider.id, apiKey, selectedModel, baseUrl);

    if (!valid) {
      throw new Error(
        "La API key no es valida o no hay conexion a internet. Verifica la key e intentalo de nuevo.",
      );
    }

    console.log("  " + t.good("API key válida\n"));

    // Usar keyId específico para openrouter
    if (selectedProvider.id === "openrouter") {
      credentialId = "laia-arch-openrouter-api-key";
      console.log(t.step("Almacenando credenciales en el keychain del sistema..."));
      await storeCredential(credentialId, apiKey);
    } else {
      console.log(t.step("Almacenando credenciales en el keychain del sistema..."));
      credentialId = await storeKeySecurely(selectedProvider.id, apiKey);
    }

    // Destruir la key de memoria inmediatamente
    apiKey = apiKey.replace(/./g, "\0");
    apiKey = "";
  }

  console.log("  " + t.good("Credenciales almacenadas de forma segura."));
  console.log(t.dim("  (La key nunca aparecerá en logs ni en el contexto de la IA)\n"));

  return {
    providerId: selectedProvider.id,
    model: selectedModel,
    credentialId,
    authMethod,
    baseUrl,
  };
}
