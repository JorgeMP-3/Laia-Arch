// bootstrap.ts — Fase 0: Configuración del proveedor IA antes del instalador conversacional

import * as crypto from "node:crypto";
import * as readline from "node:readline";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import { validateAnthropicSetupToken } from "../plugins/provider-auth-token.js";
import { storeApiKey, storeOAuthCredential, storeSetupToken } from "./credential-manager.js";
import type { AiProvider, AuthMethod, BootstrapResult } from "./types.js";
import { formatVersionForBanner, getManifestSummary } from "./version-info.js";

const REASONING_MODEL_IDS = new Set([
  "claude-opus-4-5",
  "deepseek-reasoner",
  "o1",
  "o1-mini",
  "o3",
  "o3-mini",
  "openai/o3-mini",
  "google/gemini-2.5-pro",
  "deepseek/deepseek-reasoner",
]);

function supportsReasoningModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    REASONING_MODEL_IDS.has(normalized) ||
    normalized.includes("reasoner") ||
    normalized.includes("thinking")
  );
}

function formatModelLabel(model: string): string {
  return supportsReasoningModel(model) ? `${model} ⚡ (reasoning)` : model;
}

const SUPPORTED_PROVIDERS: AiProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
    authMethods: ["API key", "Setup-token de Claude Code"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    models: ["deepseek-chat", "deepseek-reasoner"],
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini", "o1"],
    authMethods: ["API key", "OAuth Codex (suscripción)"],
  },
  {
    id: "openrouter",
    name: "OpenRouter (multi-modelo)",
    models: [
      "claude-opus-4-5",
      "deepseek/deepseek-reasoner",
      "openai/o3-mini",
      "google/gemini-2.5-pro",
      "anthropic/claude-sonnet-4-5",
      "meta-llama/llama-3.3-70b-instruct",
    ],
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

// OpenAI OAuth endpoints para el flujo Codex (mismo client_id que usa pi-ai/openclaw)
const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_AUTH_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_OAUTH_SCOPE = "openid profile email offline_access";

// Endpoint y modelos de Codex (ChatGPT backend, NO api.openai.com)
const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const OPENAI_CODEX_MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.1",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
];

// PKCE (Proof Key for Code Exchange) — requerido por el endpoint /oauth/authorize de OpenAI
function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// ─── Validación de credenciales ───────────────────────────────────────────────

async function validateApiKey(
  providerId: string,
  key: string,
  model: string,
  baseUrl?: string,
): Promise<boolean> {
  try {
    if (providerId === "anthropic") {
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
    } else if (providerId === "anthropic-token") {
      // El setup-token es un OAuth token: se envía como Bearer, no como x-api-key
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
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
    } else if (providerId === "deepseek") {
      const url = `${baseUrl ?? "https://api.deepseek.com/v1"}/chat/completions`;
      const response = await fetch(url, {
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
    } else if (providerId === "openai-compatible") {
      const url = `${baseUrl ?? "http://localhost:1234"}/chat/completions`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (key) {
        headers["Authorization"] = `Bearer ${key}`;
      }
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
    // visibleChars tracks asterisks actually printed — stays in sync
    // even when the user pastes (buffer arrives as one chunk)
    let visibleChars = 0;

    const onData = (chunk: Buffer) => {
      // Iterate byte-by-byte so paste (multi-char buffer) is handled
      // identically to individual keystrokes
      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk[i];
        const c = String.fromCharCode(byte);

        if (c === "\r" || c === "\n") {
          process.stdin.setRawMode(wasRaw);
          process.stdin.removeListener("data", onData);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(key);
          return;
        } else if (c === "\u0003") {
          // Ctrl-C
          process.stdout.write("\n");
          process.exit(1);
        } else if (c === "\u0008" || c === "\u007f") {
          // Backspace: only go back if there are visible asterisks to erase
          if (visibleChars > 0) {
            key = key.slice(0, -1);
            visibleChars--;
            process.stdout.write("\b \b");
          }
        } else if (byte >= 0x20) {
          // Printable ASCII only — ignores escape sequences (arrow keys, etc.)
          key += c;
          visibleChars++;
          process.stdout.write("*");
        }
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

/**
 * Pide un número entre min y max con reintento automático (max 3 intentos).
 * En lugar de lanzar una excepción por input inválido, repite la pregunta
 * con un mensaje amigable.
 */
async function askChoice(
  rl: readline.Interface,
  question: string,
  min: number,
  max: number,
): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await ask(rl, question);
    const num = parseInt(raw.trim(), 10);
    if (!Number.isNaN(num) && num >= min && num <= max) {
      return num;
    }
    console.log(t.warn(`Opción no válida. Introduce un número entre ${min} y ${max}.`));
  }
  rl.close();
  throw new Error("Demasiados intentos fallidos. Ejecuta laia-arch install de nuevo.");
}

// ─── Flujos de autenticación especiales ──────────────────────────────────────

async function handleSetupToken(model: string): Promise<{ profileId: string }> {
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
      t.dim(
        "  1. Instala Claude Code CLI en cualquier máquina: npm install -g @anthropic-ai/claude-code",
      ) +
      "\n" +
      t.dim("  2. Ejecuta: claude setup-token") +
      "\n" +
      t.dim("  3. Copia el token generado y pégalo aquí\n"),
  );

  let token = await askSecret("Setup-token: ");

  // Validación de formato con la función oficial de OpenClaw
  const formatError = validateAnthropicSetupToken(token);
  if (formatError) {
    throw new Error(formatError);
  }

  console.log("\n" + t.step("Validando el setup-token..."));
  const valid = await validateApiKey("anthropic-token", token, model);

  if (!valid) {
    throw new Error(
      "El setup-token no es válido o ha expirado. Ejecuta claude setup-token de nuevo.",
    );
  }

  console.log("  " + t.good("Setup-token válido\n"));

  console.log(t.step("Almacenando credenciales en auth-profiles..."));
  const profileId = storeSetupToken(token);
  token = token.replace(/./g, "\0");

  return { profileId };
}

/** Resultado completo del intercambio OAuth — mismo shape que OAuthCredentials de pi-ai */
interface CodexOAuthResult {
  access: string;
  refresh: string;
  expires: number;
}

async function exchangeOAuthCode(code: string, codeVerifier: string): Promise<CodexOAuthResult> {
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: OPENAI_OAUTH_CLIENT_ID,
      code,
      grant_type: "authorization_code",
      redirect_uri: OPENAI_OAUTH_REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Error al intercambiar el código OAuth: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
    );
  }

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new Error("La respuesta OAuth no incluye access_token.");
  }
  return {
    access: data.access_token,
    refresh: data.refresh_token ?? "",
    expires: data.expires_in ? Date.now() + data.expires_in * 1000 : Date.now() + 3600_000,
  };
}

// ─── Flujo principal ──────────────────────────────────────────────────────────

export async function runBootstrap(): Promise<BootstrapResult> {
  const version = formatVersionForBanner();
  const manifestSummary = getManifestSummary();
  console.log(t.ecosystemIntro(manifestSummary ?? undefined));
  if (manifestSummary) {
    console.log(
      `  ${t.label("Versión activa del proyecto:")} ${t.value(`LAIA A:${manifestSummary.blockA} B:${manifestSummary.blockB}`)} ${t.dim(`(build ${manifestSummary.buildNumber}, ${manifestSummary.compilationDate})`)}`,
    );
    console.log(`  ${t.dim("A = instalador, motor agentic y despliegue base.")}`);
    console.log(`  ${t.dim("B = Agora, Nemo y evolución del ecosistema operativo.")}\n`);
  } else {
    console.log(
      t.dim("  No se pudo resolver la versión semántica interna; continuaré con el modo básico.\n"),
    );
  }
  console.log(t.banner(version ?? undefined));
  console.log(t.dim("  Ahora voy a configurar el modelo de IA que guiará esta instalación.\n"));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Ctrl+C es la única salida durante la configuración del proveedor
  rl.on("SIGINT", () => {
    console.log("\n\n  Instalación cancelada.");
    rl.close();
    process.exit(1);
  });

  // 1. Seleccionar proveedor
  console.log(t.label("Proveedores disponibles:") + "\n");
  SUPPORTED_PROVIDERS.forEach((p, i) => {
    console.log(`  ${t.brand(String(i + 1) + ".")} ${p.name}`);
  });
  console.log();

  const providerNum = await askChoice(
    rl,
    `Elige el proveedor (1-${SUPPORTED_PROVIDERS.length}): `,
    1,
    SUPPORTED_PROVIDERS.length,
  );
  const selectedProvider = SUPPORTED_PROVIDERS[providerNum - 1];

  // 2. Seleccionar método de autenticación (si hay más de uno)
  let authMethod: AuthMethod = "api-key";

  if (selectedProvider.authMethods && selectedProvider.authMethods.length > 1) {
    console.log(`\n${t.label("Métodos de autenticación para")} ${selectedProvider.name}:\n`);
    selectedProvider.authMethods.forEach((m, i) => {
      console.log(`  ${t.brand(String(i + 1) + ".")} ${m}`);
    });
    console.log();

    const authNum = await askChoice(
      rl,
      `Elige el método (1-${selectedProvider.authMethods.length}): `,
      1,
      selectedProvider.authMethods.length,
    );
    const methodName = selectedProvider.authMethods[authNum - 1];
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
  } else if (selectedProvider.id === "deepseek") {
    console.log(
      "\n" +
        t.label("DeepSeek") +
        " ofrece una API compatible con OpenAI para chat y razonamiento.\n" +
        t.dim("Obtén tu API key en: ") +
        t.brand("https://platform.deepseek.com/api_keys") +
        "\n",
    );
  }

  // 4. Seleccionar modelo
  let selectedModel: string;

  if (selectedProvider.id === "openai-compatible") {
    // Para compatibles, el usuario escribe el nombre del modelo directamente
    selectedModel = (await ask(rl, "Nombre del modelo (ej: llama-3-8b): ")).trim();
    if (!selectedModel) {
      selectedModel = "local-model";
    }
  } else if (selectedProvider.id === "ollama") {
    console.log(`\nModelos conocidos de ${selectedProvider.name}:\n`);
    selectedProvider.models.forEach((m, i) => {
      console.log(`  ${i + 1}. ${formatModelLabel(m)}`);
    });
    console.log(`  ${selectedProvider.models.length + 1}. Otro (introducir nombre)`);
    console.log();

    const modelNum = await askChoice(
      rl,
      `Elige el modelo (1-${selectedProvider.models.length + 1}): `,
      1,
      selectedProvider.models.length + 1,
    );

    if (modelNum === selectedProvider.models.length + 1) {
      selectedModel = (await ask(rl, "Nombre del modelo instalado en Ollama: ")).trim();
      if (!selectedModel) {
        throw new Error("El nombre del modelo no puede estar vacío.");
      }
    } else {
      selectedModel = selectedProvider.models[modelNum - 1];
    }
  } else {
    // OAuth Codex usa modelos del ChatGPT backend, no los estándar de api.openai.com
    const modelList = authMethod === "oauth" ? OPENAI_CODEX_MODELS : selectedProvider.models;
    const modelLabel = authMethod === "oauth" ? "Modelos Codex (ChatGPT)" : selectedProvider.name;

    console.log(`\nModelos disponibles para ${modelLabel}:\n`);
    modelList.forEach((m, i) => {
      console.log(`  ${i + 1}. ${formatModelLabel(m)}`);
    });
    console.log();

    const modelNum = await askChoice(
      rl,
      `Elige el modelo (1-${modelList.length}): `,
      1,
      modelList.length,
    );
    selectedModel = modelList[modelNum - 1];
  }

  // 5. URL base para proveedores compatibles
  let baseUrl: string | undefined = selectedProvider.baseUrl;
  // OAuth Codex usa el backend de ChatGPT, no api.openai.com
  if (authMethod === "oauth") {
    baseUrl = OPENAI_CODEX_BASE_URL;
  }

  if (selectedProvider.id === "openai-compatible") {
    const input = await ask(rl, "URL base del servidor (ej: http://localhost:1234/v1): ");
    baseUrl = input.trim().replace(/\/$/, "") || "http://localhost:1234/v1";
  }

  // 6. Flujo OAuth: recoger la callback URL antes de cerrar rl
  // (la URL de callback no es un secreto, se puede usar readline)
  let oauthCallbackUrl: string | undefined;
  let oauthVerifier: string | undefined;
  if (authMethod === "oauth" && selectedProvider.id === "openai") {
    // PKCE: genera verifier y challenge para el flujo Codex
    const { verifier, challenge } = generatePkce();
    oauthVerifier = verifier;

    const state = crypto.randomBytes(16).toString("hex");
    const url = new URL(OPENAI_AUTH_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", OPENAI_OAUTH_CLIENT_ID);
    url.searchParams.set("redirect_uri", OPENAI_OAUTH_REDIRECT_URI);
    url.searchParams.set("scope", OPENAI_OAUTH_SCOPE);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("id_token_add_organizations", "true");
    url.searchParams.set("codex_cli_simplified_flow", "true");
    url.searchParams.set("originator", "pi");
    const authUrl = url.toString();

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
          "(empezará por http://localhost:1455/auth/callback?...)\n" +
          "y pégala aquí:",
      ),
    );
    oauthCallbackUrl = await ask(rl, "\nURL de callback: ");
  }

  rl.close();

  // ─── Ejecutar autenticación ────────────────────────────────────────────────

  let profileId: string;
  let authType: BootstrapResult["authType"] = "api_key";

  if (selectedProvider.id === "ollama") {
    console.log("\n" + t.step("Verificando servidor Ollama local..."));
    const valid = await validateApiKey("ollama", "", selectedModel);
    if (!valid) {
      throw new Error(
        "No se puede conectar con Ollama en localhost:11434. Asegurate de que Ollama esta instalado y corriendo.",
      );
    }
    console.log("  " + t.good("Ollama disponible\n"));
    // Ollama no necesita credencial — guardamos un api_key vacía para consistencia
    profileId = storeApiKey("ollama", "");
    authType = "api_key";
  } else if (authMethod === "setup-token") {
    const result = await handleSetupToken(selectedModel);
    profileId = result.profileId;
    authType = "token";
  } else if (authMethod === "oauth") {
    // Extraer el código de la callback URL recogida con readline
    const callbackUrl = oauthCallbackUrl ?? "";
    let code: string;
    try {
      const url = new URL(callbackUrl.trim());
      const codeParam = url.searchParams.get("code");
      if (!codeParam) {
        throw new Error("no hay parámetro 'code' en la URL");
      }
      code = codeParam;
    } catch (err) {
      throw new Error(`URL de callback inválida: ${(err as Error).message}`, { cause: err });
    }

    console.log("\n" + t.step("Intercambiando código por token de acceso..."));
    const oauthCreds = await exchangeOAuthCode(code, oauthVerifier ?? "");
    console.log("  " + t.good("Token obtenido\n"));

    // No validamos contra /v1/chat/completions — el token Codex es de suscripción,
    // no una API key estándar. El flujo original de OpenClaw tampoco valida:
    // confía en el intercambio OAuth exitoso (igual que pi-ai).

    console.log(t.step("Almacenando credenciales en auth-profiles..."));
    // Almacenar como type: "oauth" con refresh token — mismo patrón que el onboarding real
    profileId = storeOAuthCredential(
      "openai-codex",
      oauthCreds.access,
      oauthCreds.refresh,
      oauthCreds.expires,
    );
    authType = "oauth";
  } else {
    // Flujo estándar: API key
    const providerLabel =
      selectedProvider.id === "openrouter" ? "OpenRouter" : selectedProvider.name;
    let apiKey = await askSecret(`\nIntroduce tu API key de ${providerLabel}: `);

    if (!apiKey || apiKey.length < 8) {
      throw new Error(
        "API key demasiado corta (mínimo 8 caracteres). " +
          "Verifica que la has copiado correctamente y ejecuta laia-arch install de nuevo.",
      );
    }

    // Validación opcional de formato
    if (selectedProvider.id === "openrouter" && !apiKey.startsWith("sk-or-")) {
      console.warn(
        t.warn(
          '  ⚠ La API key de OpenRouter debería empezar por "sk-or-". Continuando de todas formas...',
        ),
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

    console.log(t.step("Almacenando credenciales en auth-profiles..."));
    profileId = storeApiKey(selectedProvider.id, apiKey);
    authType = "api_key";

    // Destruir la key de memoria inmediatamente
    apiKey = apiKey.replace(/./g, "\0");
    apiKey = "";
  }

  console.log("  " + t.good("Credenciales almacenadas de forma segura."));
  console.log(t.dim("  (La key nunca aparecerá en logs ni en el contexto de la IA)\n"));

  return {
    // OAuth Codex usa un provider distinto: "openai-codex" ruteará a la Responses API
    providerId: authMethod === "oauth" ? "openai-codex" : selectedProvider.id,
    model: selectedModel,
    profileId,
    authMethod,
    authType,
    baseUrl,
    supportsReasoning: supportsReasoningModel(selectedModel),
  } as BootstrapResult & { supportsReasoning: boolean };
}
