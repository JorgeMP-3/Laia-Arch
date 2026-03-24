import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { laiaTheme as theme } from "../cli/laia-arch-theme.js";
import { extractCredentialValue, retrieveProfileCredential } from "./credential-manager.js";
import type { BootstrapResult } from "./types.js";
import { checkServiceStatus } from "./tools/system-tools.js";

export interface InstalledServices {
  bind9: boolean;
  ldap: boolean;
  samba: boolean;
  wireguard: boolean;
  docker: boolean;
  nginx: boolean;
  cockpit: boolean;
  sambaData: boolean;
  backupScript: boolean;
  laiaConfig: boolean;
  ldapData: boolean;
  logs: boolean;
}

type UninstallServiceKey =
  | "bind9"
  | "ldap"
  | "samba"
  | "wireguard"
  | "docker"
  | "nginx"
  | "cockpit"
  | "backups"
  | "config"
  | "logs";

type RemovalResult = {
  step: string;
  success: boolean;
  skipped?: boolean;
  error?: string;
};

const UNINSTALL_SERVICE_KEYS: UninstallServiceKey[] = [
  "cockpit",
  "nginx",
  "docker",
  "wireguard",
  "samba",
  "ldap",
  "bind9",
  "backups",
  "logs",
  "config",
];

const SERVICE_LABELS: Record<UninstallServiceKey, string> = {
  bind9: "BIND9 (DNS interno)",
  ldap: "OpenLDAP (usuarios)",
  samba: "Samba (carpetas compartidas)",
  wireguard: "WireGuard",
  docker: "Docker",
  nginx: "Nginx",
  cockpit: "Cockpit",
  backups: "Backups y script de copia",
  logs: "Logs de Laia Arch",
  config: "Configuración local de Laia Arch",
};

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function askYesNo(rl: readline.Interface, question: string): Promise<boolean> {
  const answer = (await ask(rl, `  ${question} `)).trim().toLowerCase();
  return answer === "s" || answer === "si" || answer === "sí" || answer === "y" || answer === "yes";
}

function normalizeSelection(services?: string[]): Set<UninstallServiceKey> {
  if (!services || services.length === 0) {
    return new Set(UNINSTALL_SERVICE_KEYS);
  }

  const normalized = new Set<UninstallServiceKey>();
  for (const service of services) {
    const key = service.trim().toLowerCase() as UninstallServiceKey;
    if ((UNINSTALL_SERVICE_KEYS as string[]).includes(key)) {
      normalized.add(key);
    }
  }
  return normalized;
}

function pathExists(targetPath: string): boolean {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

function dirHasEntries(targetPath: string): boolean {
  try {
    return fs.readdirSync(targetPath).length > 0;
  } catch {
    return false;
  }
}

function isServiceActive(status: Awaited<ReturnType<typeof checkServiceStatus>>): boolean {
  return status.success && status.status === "active";
}

function runShell(command: string): void {
  execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function printDetectedServices(installed: InstalledServices): void {
  const lines = [
    "┌─────────────────────────────────────────┐",
    "│  Servicios a desinstalar:               │",
    `│  ${installed.bind9 ? "✓" : "✗"} BIND9 (DNS interno)                  │`,
    `│  ${installed.ldap ? "✓" : "✗"} OpenLDAP (usuarios)                  │`,
    `│  ${installed.samba ? "✓" : "✗"} Samba (carpetas compartidas)         │`,
    `│  ${installed.wireguard ? "✓" : "✗"} WireGuard                            │`,
    `│  ${installed.docker ? "✓" : "✗"} Docker                               │`,
    `│  ${installed.nginx ? "✓" : "✗"} Nginx                                │`,
    `│  ${installed.cockpit ? "✓" : "✗"} Cockpit                              │`,
    "│                                         │",
    "│  Datos que se eliminarán:               │",
    `│  ${installed.sambaData ? "✓" : "✗"} /srv/samba/                        │`,
    `│  ${installed.ldapData ? "✓" : "✗"} /var/lib/ldap/                     │`,
    `│  ${installed.laiaConfig ? "✓" : "✗"} ~/.laia-arch/                     │`,
    `│  ${installed.backupScript ? "✓" : "✗"} /backup/ y script de backup     │`,
    `│  ${installed.logs ? "✓" : "✗"} /var/log/laia-arch/                 │`,
    "└─────────────────────────────────────────┘",
  ];

  console.log();
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  console.log();
}

async function confirmDangerousUninstall(
  rl: readline.Interface,
  selected: Set<UninstallServiceKey>,
): Promise<boolean> {
  console.log(
    "\n  " +
      theme.warn(
        "ATENCIÓN: Esta operación es irreversible.\n" +
          "  Todos los datos de usuarios, carpetas compartidas y configuraciones seleccionadas\n" +
          "  se eliminarán permanentemente. Asegúrate de tener una copia de seguridad si la necesitas.",
      ),
  );
  console.log("  " + theme.dim(`Se eliminará: ${[...selected].map((entry) => SERVICE_LABELS[entry]).join(", ")}`));

  const first = await askYesNo(rl, "¿Quieres continuar? (s/n):");
  if (!first) {
    return false;
  }

  const confirmText = await ask(rl, '  Escribe CONFIRMAR para proceder: ');
  return confirmText.trim() === "CONFIRMAR";
}

async function confirmContinueOnError(rl: readline.Interface, error: string): Promise<boolean> {
  console.log("  " + theme.bad(error));
  return askYesNo(rl, "¿Quieres continuar con el resto de la desinstalación? (s/n):");
}

function selectedHas(selected: Set<UninstallServiceKey>, service: UninstallServiceKey): boolean {
  return selected.has(service);
}

async function removeService(
  rl: readline.Interface,
  label: string,
  commands: string[],
): Promise<RemovalResult> {
  console.log(theme.step(`Desinstalando ${label}...`));
  try {
    for (const command of commands) {
      runShell(command);
    }
    console.log("  " + theme.good(`${label} eliminado`));
    return { step: label, success: true };
  } catch (error) {
    const message = summarizeError(error);
    const shouldContinue = await confirmContinueOnError(
      rl,
      `${label}: ${message}`,
    );
    return { step: label, success: false, error: message + (shouldContinue ? "" : " (abortado)") };
  }
}

async function callUninstallAI(
  bootstrap: BootstrapResult,
  systemPrompt: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<string> {
  const apiKey =
    bootstrap.providerId === "ollama"
      ? ""
      : extractCredentialValue(retrieveProfileCredential(bootstrap.profileId));

  if (bootstrap.providerId === "anthropic") {
    const headers: Record<string, string> =
      bootstrap.authMethod === "setup-token"
        ? {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "anthropic-version": "2023-06-01",
          }
        : {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: bootstrap.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages
          .filter((message) => message.role !== "system")
          .map((message) => ({ role: message.role, content: message.content })),
      }),
    });
    if (!response.ok) {
      throw new Error(`Anthropic API ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    return data.content?.find((entry) => entry.type === "text")?.text ?? "";
  }

  if (
    bootstrap.providerId === "openai" ||
    bootstrap.providerId === "openrouter" ||
    bootstrap.providerId === "openai-compatible" ||
    bootstrap.providerId === "deepseek"
  ) {
    const baseUrl =
      bootstrap.baseUrl ??
      (bootstrap.providerId === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : bootstrap.providerId === "deepseek"
          ? "https://api.deepseek.com/v1"
          : bootstrap.providerId === "openai-compatible"
            ? "http://localhost:1234"
            : "https://api.openai.com/v1");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (bootstrap.providerId !== "openai-compatible" || apiKey) {
      headers.Authorization = `Bearer ${apiKey || "none"}`;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: bootstrap.model,
        max_tokens: 2048,
        temperature: 0.3,
        messages: [{ role: "system", content: systemPrompt }, ...messages.filter((m) => m.role !== "system")],
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI-compatible API ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    return data.choices?.[0]?.message?.content ?? "";
  }

  if (bootstrap.providerId === "ollama") {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: bootstrap.model,
        stream: false,
        messages: [{ role: "system", content: systemPrompt }, ...messages.filter((m) => m.role !== "system")],
        options: { temperature: 0.3 },
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama API ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  }

  throw new Error(`Proveedor no soportado: ${bootstrap.providerId}`);
}

function extractServicePlan(raw: string): UninstallServiceKey[] {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { services?: string[] };
    return (parsed.services ?? [])
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry): entry is UninstallServiceKey =>
        (UNINSTALL_SERVICE_KEYS as string[]).includes(entry),
      );
  } catch {
    return [];
  }
}

export async function detectInstalledServices(): Promise<InstalledServices> {
  const [bind9, ldap, samba, wireguard, docker, nginx, cockpit] = await Promise.all([
    Promise.resolve(checkServiceStatus("bind9")),
    Promise.resolve(checkServiceStatus("slapd")),
    Promise.resolve(checkServiceStatus("smbd")),
    Promise.resolve(checkServiceStatus("wg-quick@wg0")),
    Promise.resolve(checkServiceStatus("docker")),
    Promise.resolve(checkServiceStatus("nginx")),
    Promise.resolve(checkServiceStatus("cockpit")),
  ]);

  return {
    bind9: isServiceActive(bind9),
    ldap: isServiceActive(ldap),
    samba: isServiceActive(samba),
    wireguard: isServiceActive(wireguard),
    docker: isServiceActive(docker),
    nginx: isServiceActive(nginx),
    cockpit: isServiceActive(cockpit),
    sambaData: pathExists("/srv/samba") && dirHasEntries("/srv/samba"),
    backupScript:
      pathExists("/usr/local/bin/backup-laia.sh") ||
      pathExists("/usr/local/bin/laia-arch-backup") ||
      pathExists("/backup"),
    laiaConfig: pathExists(path.join(os.homedir(), ".laia-arch")),
    ldapData: pathExists("/var/lib/ldap") && dirHasEntries("/var/lib/ldap"),
    logs: pathExists("/var/log/laia-arch"),
  };
}

export async function runGenericUninstall(services?: string[]): Promise<void> {
  const installed = await detectInstalledServices();
  const selected = normalizeSelection(services);

  printDetectedServices(installed);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  try {
    const confirmed = await confirmDangerousUninstall(rl, selected);
    if (!confirmed) {
      console.log("\n  " + theme.muted("Desinstalación cancelada."));
      return;
    }

    const results: RemovalResult[] = [];

    if (selectedHas(selected, "cockpit") && installed.cockpit) {
      results.push(
        await removeService(rl, "Cockpit", [
          "sudo systemctl stop cockpit || true",
          "sudo systemctl stop cockpit.socket || true",
          "sudo apt-get remove --purge cockpit -y",
        ]),
      );
    }

    if (selectedHas(selected, "nginx") && installed.nginx) {
      results.push(
        await removeService(rl, "Nginx", [
          "sudo systemctl stop nginx || true",
          "sudo apt-get remove --purge nginx -y",
        ]),
      );
    }

    if (selectedHas(selected, "docker") && installed.docker) {
      results.push(
        await removeService(rl, "Docker", [
          "sudo systemctl stop docker || true",
          "sudo apt-get remove --purge docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y",
          "sudo rm -f /etc/apt/sources.list.d/docker.list",
        ]),
      );
    }

    if (selectedHas(selected, "wireguard") && installed.wireguard) {
      results.push(
        await removeService(rl, "WireGuard", [
          "sudo systemctl stop wg-quick@wg0 || true",
          "sudo apt-get remove --purge wireguard wireguard-tools -y",
          "sudo rm -rf /etc/wireguard/",
        ]),
      );
    }

    if (selectedHas(selected, "samba") && installed.samba) {
      results.push(
        await removeService(rl, "Samba", [
          "sudo systemctl stop smbd || true",
          "sudo systemctl stop nmbd || true",
          "sudo apt-get remove --purge samba -y",
          "sudo rm -rf /srv/samba/",
        ]),
      );
    } else if (selectedHas(selected, "samba") && installed.sambaData) {
      results.push(await removeService(rl, "Datos de Samba", ["sudo rm -rf /srv/samba/"]));
    }

    if (selectedHas(selected, "ldap") && installed.ldap) {
      results.push(
        await removeService(rl, "OpenLDAP", [
          "sudo systemctl stop slapd || true",
          "sudo apt-get remove --purge slapd ldap-utils -y",
          "sudo rm -rf /var/lib/ldap/ /etc/ldap/",
        ]),
      );
    } else if (selectedHas(selected, "ldap") && installed.ldapData) {
      results.push(await removeService(rl, "Datos LDAP", ["sudo rm -rf /var/lib/ldap/ /etc/ldap/"]));
    }

    if (selectedHas(selected, "bind9") && installed.bind9) {
      results.push(
        await removeService(rl, "BIND9", [
          "sudo systemctl stop bind9 || true",
          "sudo apt-get remove --purge bind9 bind9utils bind9-doc -y",
          "sudo rm -rf /etc/bind/zones/",
        ]),
      );
    }

    if (selectedHas(selected, "backups") && installed.backupScript) {
      results.push(
        await removeService(rl, "Backups", [
          "sudo rm -rf /backup/",
          "sudo rm -f /usr/local/bin/backup-laia.sh /usr/local/bin/laia-arch-backup",
          "crontab -l 2>/dev/null | grep -v 'backup-laia\\|laia-arch-backup' | crontab - || true",
          "sudo rm -f /etc/cron.d/laia-arch-backup",
        ]),
      );
    }

    if (selectedHas(selected, "logs") && installed.logs) {
      results.push(await removeService(rl, "Logs de Laia Arch", ["sudo rm -rf /var/log/laia-arch/"]));
    }

    if (selectedHas(selected, "config") && installed.laiaConfig) {
      results.push(
        await removeService(rl, "Configuración local de Laia Arch", [
          `rm -rf ${JSON.stringify(path.join(os.homedir(), ".laia-arch"))}`,
        ]),
      );
    }

    const failed = results.filter((entry) => !entry.success);
    const succeeded = results.filter((entry) => entry.success);

    console.log();
    if (succeeded.length > 0) {
      console.log("  " + theme.good(`Eliminado: ${succeeded.map((entry) => entry.step).join(", ")}`));
    }
    if (failed.length > 0) {
      console.log("  " + theme.warn(`Con incidencias: ${failed.map((entry) => entry.step).join(", ")}`));
      for (const entry of failed) {
        console.log("    " + theme.dim(`${entry.step}: ${entry.error ?? "error desconocido"}`));
      }
    }
    if (failed.length === 0) {
      console.log("\n  " + theme.good("Desinstalación completada. El servidor está limpio."));
    } else {
      console.log("\n  " + theme.warn("Desinstalación completada con errores parciales."));
    }
  } finally {
    rl.close();
  }
}

export async function runGuidedUninstall(bootstrapResult: BootstrapResult): Promise<void> {
  const installed = await detectInstalledServices();
  const installedSummary = Object.entries(installed)
    .map(([key, value]) => `${key}: ${value ? "sí" : "no"}`)
    .join(", ");

  const systemPrompt =
    "Eres Laia Arch. El ecosistema LAIA está instalado en este servidor con los siguientes servicios: " +
    installedSummary +
    ".\n\n" +
    "El administrador quiere desinstalar parte o todo el ecosistema.\n" +
    "Tu trabajo es:\n" +
    "- Preguntar qué quiere conservar y qué quiere eliminar\n" +
    "- Advertir de las dependencias (por ejemplo, si elimina LDAP pero conserva Samba, los usuarios no podrán acceder)\n" +
    "- Sugerir hacer backup de los datos importantes antes\n" +
    "- Confirmar el plan antes de ejecutar\n" +
    "- Hablar de forma breve y clara\n\n" +
    "Cuando el administrador deje claro qué quiere eliminar, termina tu respuesta con una línea que empiece por PLAN: y enumera los componentes.";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.on("SIGINT", () => {
    console.log("\n\n  Desinstalación cancelada.");
    rl.close();
    process.exit(1);
  });

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content:
        `Estado detectado: ${installedSummary}.\n` +
        "Ayúdame a decidir qué conservar y qué eliminar.",
    },
  ];

  try {
    while (true) {
      process.stdout.write("  (pensando...)\r");
      const reply = await callUninstallAI(bootstrapResult, systemPrompt, messages);
      process.stdout.write("                \r");

      console.log();
      console.log("  " + theme.label("Laia: ") + theme.value(reply));
      console.log();

      messages.push({ role: "assistant", content: reply });

      const input = await ask(
        rl,
        '  Tú: ',
      );
      const normalized = input.trim().toLowerCase();

      if (normalized === "terminar") {
        console.log("\n  " + theme.muted("Desinstalación guiada cancelada por el administrador."));
        return;
      }

      if (normalized === "aprobar" || normalized === "aprobado" || normalized === "confirmar") {
        const extractionPrompt =
          "Devuelve únicamente JSON válido con esta forma: " +
          '{"services":["cockpit","nginx","docker","wireguard","samba","ldap","bind9","backups","logs","config"]}. ' +
          "Incluye solo los componentes que el administrador ha aprobado eliminar.";
        const rawPlan = await callUninstallAI(bootstrapResult, extractionPrompt, messages);
        const services = extractServicePlan(rawPlan);

        if (services.length === 0) {
          console.log(
            "\n  " +
              theme.warn(
                "No pude extraer un plan de desinstalación claro. Indica explícitamente qué componentes quieres eliminar y vuelve a escribir 'aprobar'.",
              ),
          );
          continue;
        }

        console.log(
          "\n  " +
            theme.step(`Plan aprobado: ${services.map((entry) => SERVICE_LABELS[entry]).join(", ")}`),
        );
        rl.close();
        await runGenericUninstall(services);
        return;
      }

      messages.push({ role: "user", content: input });
    }
  } finally {
    rl.close();
  }
}
