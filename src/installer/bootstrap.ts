// bootstrap.ts — Fase 0: Configuración del proveedor IA antes del instalador conversacional

import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as readline from "node:readline";
import type { BootstrapResult, AiProvider } from "./types.js";

const SUPPORTED_PROVIDERS: AiProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    models: ["gpt-4o", "gpt-4o-mini"],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    models: ["llama3.1", "mistral", "qwen2.5"],
  },
  {
    id: "openai-compatible",
    name: "OpenAI compatible (LM Studio, vLLM...)",
    models: ["local-model"],
  },
];

async function storeKeySecurely(providerId: string, key: string): Promise<string> {
  const keyId = `laia-arch-${providerId}-api-key`;
  const platform = os.platform();

  try {
    if (platform === "linux") {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("secret-tool", [
          "store",
          "--label",
          `Laia Arch API key (${providerId})`,
          "service",
          "laia-arch",
          "key",
          keyId,
        ]);
        proc.stdin.write(key);
        proc.stdin.end();
        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`secret-tool failed with code ${code}`));
          }
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
    // Fallback: file with 600 permissions
    const configDir = `${os.homedir()}/.laia-arch`;
    fs.mkdirSync(configDir, { recursive: true });
    const keyFile = `${configDir}/.${keyId}`;
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
    console.warn("  Aviso: keychain no disponible. La key se guardó en archivo protegido (600).");
  }

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
    // Try file fallback regardless of platform
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
    } else if (providerId === "openai-compatible") {
      const url = `${baseUrl ?? "http://localhost:1234"}/v1/chat/completions`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key || "none"}`,
        },
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

export async function runBootstrap(): Promise<BootstrapResult> {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║       LAIA ARCH — Instalador conversacional             ║");
  console.log("║       El arquitecto que construye tu servidor           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("\nAntes de empezar necesito configurar el modelo de IA.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("Proveedores disponibles:\n");
  SUPPORTED_PROVIDERS.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.name}`);
  });
  console.log();

  const providerChoice = await ask(rl, `Elige el proveedor (1-${SUPPORTED_PROVIDERS.length}): `);
  const providerIndex = parseInt(providerChoice, 10) - 1;

  if (providerIndex < 0 || providerIndex >= SUPPORTED_PROVIDERS.length) {
    rl.close();
    throw new Error("Opcion no valida. Ejecuta laia-arch install de nuevo.");
  }

  const selectedProvider = SUPPORTED_PROVIDERS[providerIndex];

  console.log(`\nModelos disponibles para ${selectedProvider.name}:\n`);
  selectedProvider.models.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m}`);
  });
  console.log();

  const modelChoice = await ask(rl, `Elige el modelo (1-${selectedProvider.models.length}): `);
  const modelIndex = parseInt(modelChoice, 10) - 1;

  if (modelIndex < 0 || modelIndex >= selectedProvider.models.length) {
    rl.close();
    throw new Error("Modelo no valido.");
  }

  const selectedModel = selectedProvider.models[modelIndex];

  let baseUrl: string | undefined;
  if (selectedProvider.id === "openai-compatible") {
    baseUrl = await ask(rl, "URL base del servidor (ej: http://localhost:1234): ");
    baseUrl = baseUrl.trim().replace(/\/$/, "") || "http://localhost:1234";
  }

  rl.close();

  let apiKey = "";
  if (selectedProvider.id !== "ollama") {
    apiKey = await askSecret(`\nIntroduce tu API key de ${selectedProvider.name}: `);

    if (!apiKey || apiKey.length < 8) {
      throw new Error("API key demasiado corta. Verifica que la has copiado correctamente.");
    }

    console.log("\n  Validando la API key...");
    const valid = await validateApiKey(selectedProvider.id, apiKey, selectedModel, baseUrl);

    if (!valid) {
      throw new Error(
        "La API key no es valida o no hay conexion a internet. Verifica la key e intentalo de nuevo.",
      );
    }

    console.log("  API key valida\n");
  } else {
    console.log("\n  Verificando servidor Ollama local...");
    const valid = await validateApiKey("ollama", "", selectedModel);
    if (!valid) {
      throw new Error(
        "No se puede conectar con Ollama en localhost:11434. Asegurate de que Ollama esta instalado y corriendo.",
      );
    }
    console.log("  Ollama disponible\n");
  }

  console.log("  Almacenando credenciales en el keychain del sistema...");
  const credentialId = await storeKeySecurely(selectedProvider.id, apiKey);
  // Destroy key from memory immediately
  apiKey = apiKey.replace(/./g, "\0");
  apiKey = "";
  console.log("  Credenciales almacenadas de forma segura.");
  console.log("  (La key nunca aparecera en logs ni en el contexto de la IA)\n");

  return {
    providerId: selectedProvider.id,
    model: selectedModel,
    credentialId,
    baseUrl,
  };
}
