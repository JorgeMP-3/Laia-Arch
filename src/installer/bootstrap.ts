// bootstrap.ts — Fase 0: Configuración del proveedor IA antes del instalador conversacional

import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as readline from "readline";

export interface BootstrapResult {
  provider: "anthropic" | "openai" | "ollama" | "compatible";
  model: string;
  apiKeyId: string;
  validated: boolean;
}

const SUPPORTED_PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
  },
  { id: "openai", name: "OpenAI (GPT)", models: ["gpt-4o", "gpt-4o-mini"] },
  { id: "ollama", name: "Ollama (local)", models: ["llama3.1", "mistral", "qwen2.5"] },
];

async function storeKeySecurely(provider: string, key: string): Promise<string> {
  const keyId = `laia-arch-${provider}-api-key`;
  const platform = os.platform();

  try {
    if (platform === "linux") {
      const proc = spawn("secret-tool", [
        "store",
        "--label",
        keyId,
        "service",
        "laia-arch",
        "key",
        keyId,
      ]);
      proc.stdin.write(key);
      proc.stdin.end();
      await new Promise((resolve, reject) => {
        proc.on("close", (code) =>
          code === 0 ? resolve(null) : reject(new Error(`secret-tool falló con código ${code}`)),
        );
      });
    } else if (platform === "darwin") {
      execSync(`security add-generic-password -a laia-arch -s ${keyId} -w`, {
        input: key,
        stdio: ["pipe", "ignore", "ignore"],
      });
    } else {
      const configDir = `${os.homedir()}/.laia-arch`;
      fs.mkdirSync(configDir, { recursive: true });
      const keyFile = `${configDir}/.${keyId}`;
      fs.writeFileSync(keyFile, key, { mode: 0o600 });
      console.warn("⚠ Keychain no disponible. La key se guardó en archivo protegido.");
    }
  } catch {
    const configDir = `${os.homedir()}/.laia-arch`;
    fs.mkdirSync(configDir, { recursive: true });
    const keyFile = `${configDir}/.${keyId}`;
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
  }

  key = key.replace(/./g, "0");
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
    throw new Error(
      `No se pudo recuperar la credencial: ${keyId}. Ejecuta laia-arch install de nuevo.`,
    );
  }
}

async function validateApiKey(provider: string, key: string, model: string): Promise<boolean> {
  try {
    if (provider === "anthropic") {
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
    } else if (provider === "openai") {
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
    } else if (provider === "ollama") {
      const response = await fetch("http://localhost:11434/api/tags");
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
    const stdin = process.openStdin();
    process.stdin.setRawMode(true);
    let key = "";
    process.stdin.on("data", (char) => {
      const c = char.toString();
      if (c === "\r" || c === "\n") {
        process.stdin.setRawMode(false);
        process.stdout.write("\n");
        stdin.pause();
        resolve(key);
      } else if (c === "\u0008" || c === "\u007f") {
        if (key.length > 0) {
          key = key.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        key += c;
        process.stdout.write("*");
      }
    });
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

  const providerChoice = await ask(rl, "Elige el proveedor (1-3): ");
  const providerIndex = parseInt(providerChoice) - 1;

  if (providerIndex < 0 || providerIndex >= SUPPORTED_PROVIDERS.length) {
    rl.close();
    throw new Error("Opción no válida. Ejecuta laia-arch install de nuevo.");
  }

  const selectedProvider = SUPPORTED_PROVIDERS[providerIndex];

  console.log(`\nModelos disponibles para ${selectedProvider.name}:\n`);
  selectedProvider.models.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m}`);
  });
  console.log();

  const modelChoice = await ask(rl, `Elige el modelo (1-${selectedProvider.models.length}): `);
  const modelIndex = parseInt(modelChoice) - 1;

  if (modelIndex < 0 || modelIndex >= selectedProvider.models.length) {
    rl.close();
    throw new Error("Modelo no válido.");
  }

  const selectedModel = selectedProvider.models[modelIndex];
  rl.close();

  let apiKey = "";
  if (selectedProvider.id !== "ollama") {
    apiKey = await askSecret(`\nIntroduce tu API key de ${selectedProvider.name}: `);

    if (!apiKey || apiKey.length < 10) {
      throw new Error("API key demasiado corta. Verifica que la has copiado correctamente.");
    }

    console.log("\n→ Validando la API key...");
    const valid = await validateApiKey(selectedProvider.id, apiKey, selectedModel);

    if (!valid) {
      throw new Error(
        "La API key no es válida o no hay conexión a internet. Verifica la key e inténtalo de nuevo.",
      );
    }

    console.log("✓ API key válida\n");
  } else {
    console.log("\n→ Verificando servidor Ollama local...");
    const valid = await validateApiKey("ollama", "", selectedModel);
    if (!valid) {
      throw new Error(
        "No se puede conectar con Ollama en localhost:11434. Asegúrate de que Ollama está instalado y corriendo.",
      );
    }
    console.log("✓ Ollama disponible\n");
  }

  console.log("→ Almacenando credenciales en el keychain del sistema...");
  const keyId = await storeKeySecurely(selectedProvider.id, apiKey);
  apiKey = "";
  console.log("✓ Credenciales almacenadas de forma segura");
  console.log("  (La key nunca aparecerá en logs ni en el contexto de la IA)\n");

  return {
    provider: selectedProvider.id as BootstrapResult["provider"],
    model: selectedModel,
    apiKeyId: keyId,
    validated: true,
  };
}
