import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { laiaTheme as theme } from "../cli/laia-arch-theme.js";
import { extractCredentialValue, retrieveProfileCredential } from "./credential-manager.js";
import { checkServiceStatus } from "./tools/system-tools.js";
import type { BootstrapResult } from "./types.js";

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

const LAIA_HOME_DIR = path.join(os.homedir(), ".laia-arch");
const LAIA_SUDOERS_FILE = "/etc/sudoers.d/laia-arch";
const BACKUP_ROOT_DIR = "/backup";
const BACKUP_ARCHIVE_DIR = "/var/backups/laia-arch";
const BACKUP_CRON_FILE = "/etc/cron.d/laia-arch-backup";
const DOCKER_APT_SOURCE_FILE = "/etc/apt/sources.list.d/docker.list";
const DOCKER_APT_KEYRING_FILE = "/etc/apt/keyrings/docker.asc";
const DOCKER_DATA_DIRS = ["/var/lib/docker", "/var/lib/containerd", "/etc/docker"] as const;
const BIND_ZONE_DIR = "/etc/bind/zones";
const BIND_ZONE_GLOB = "/etc/bind/db.*";

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

function isServiceInstalled(status: Awaited<ReturnType<typeof checkServiceStatus>>): boolean {
  return status.success && status.status !== "not-installed";
}

function runShell(command: string): void {
  execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: "/bin/bash",
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
  console.log(
    "  " +
      theme.dim(`Se eliminará: ${[...selected].map((entry) => SERVICE_LABELS[entry]).join(", ")}`),
  );

  const first = await askYesNo(rl, "¿Quieres continuar? (s/n):");
  if (!first) {
    return false;
  }

  const confirmText = await ask(rl, "  Escribe CONFIRMAR para proceder: ");
  return confirmText.trim() === "CONFIRMAR";
}

async function confirmContinueOnError(rl: readline.Interface, error: string): Promise<boolean> {
  console.log("  " + theme.bad(error));
  return askYesNo(rl, "¿Quieres continuar con el resto de la desinstalación? (s/n):");
}

function selectedHas(selected: Set<UninstallServiceKey>, service: UninstallServiceKey): boolean {
  return selected.has(service);
}

export function buildRemovalCommands(
  homeDir = os.homedir(),
): Record<UninstallServiceKey, string[]> {
  return {
    cockpit: [
      "sudo systemctl disable --now cockpit.socket || true",
      "sudo systemctl stop cockpit || true",
      "sudo apt-get remove --purge cockpit -y",
    ],
    nginx: [
      "sudo systemctl disable --now nginx || true",
      "sudo apt-get remove --purge nginx nginx-common -y",
    ],
    docker: [
      "sudo systemctl disable --now docker docker.socket containerd || true",
      "sudo apt-get remove --purge docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras -y",
      `sudo rm -f ${DOCKER_APT_SOURCE_FILE} ${DOCKER_APT_KEYRING_FILE}`,
      `sudo rm -rf ${DOCKER_DATA_DIRS.join(" ")}`,
    ],
    wireguard: [
      "sudo systemctl disable --now wg-quick@wg0 || true",
      "sudo apt-get remove --purge wireguard wireguard-tools -y",
      "sudo rm -rf /etc/wireguard/",
    ],
    samba: [
      "sudo systemctl disable --now smbd nmbd || true",
      "sudo apt-get remove --purge samba samba-common samba-common-bin -y",
      "sudo rm -rf /srv/samba/ /etc/samba/",
    ],
    ldap: [
      "sudo systemctl disable --now slapd || true",
      "sudo apt-get remove --purge slapd ldap-utils -y",
      "sudo rm -rf /var/lib/ldap/ /etc/ldap/",
    ],
    bind9: [
      "sudo systemctl disable --now bind9 named || true",
      "sudo apt-get remove --purge bind9 bind9utils bind9-doc -y",
      'sudo sed -i -E \'/^[[:space:]]*zone "[^"]+" \\{ type master; file "\\/etc\\/bind\\/db\\.[^"]+"; \\};[[:space:]]*$/d\' /etc/bind/named.conf.local 2>/dev/null || true',
      `sudo rm -rf ${BIND_ZONE_DIR}`,
      `sudo find /etc/bind -maxdepth 1 -type f -name '${path.posix.basename(BIND_ZONE_GLOB)}' -delete 2>/dev/null || true`,
    ],
    backups: [
      `sudo rm -rf ${BACKUP_ROOT_DIR}/ ${BACKUP_ARCHIVE_DIR}/`,
      "sudo rm -f /usr/local/bin/backup-laia.sh /usr/local/bin/laia-arch-backup",
      "crontab -l 2>/dev/null | grep -v 'backup-laia\\|laia-arch-backup' | crontab - || true",
      `sudo rm -f ${BACKUP_CRON_FILE}`,
    ],
    logs: ["sudo rm -rf /var/log/laia-arch/"],
    config: [
      `rm -rf ${JSON.stringify(path.join(homeDir, ".laia-arch"))}`,
      `sudo rm -f ${LAIA_SUDOERS_FILE}`,
    ],
  };
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
    const shouldContinue = await confirmContinueOnError(rl, `${label}: ${message}`);
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
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.filter((m) => m.role !== "system"),
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI-compatible API ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    return data.choices?.[0]?.message?.content ?? "";
  }

  if (bootstrap.providerId === "ollama") {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: bootstrap.model,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.filter((m) => m.role !== "system"),
        ],
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
  const [bind9, named, ldap, samba, nmbd, wireguard, docker, nginx, cockpit, cockpitSocket] =
    await Promise.all([
      Promise.resolve(checkServiceStatus("bind9")),
      Promise.resolve(checkServiceStatus("named")),
      Promise.resolve(checkServiceStatus("slapd")),
      Promise.resolve(checkServiceStatus("smbd")),
      Promise.resolve(checkServiceStatus("nmbd")),
      Promise.resolve(checkServiceStatus("wg-quick@wg0")),
      Promise.resolve(checkServiceStatus("docker")),
      Promise.resolve(checkServiceStatus("nginx")),
      Promise.resolve(checkServiceStatus("cockpit")),
      Promise.resolve(checkServiceStatus("cockpit.socket")),
    ]);

  return {
    bind9: isServiceInstalled(bind9) || isServiceInstalled(named) || pathExists(BIND_ZONE_DIR),
    ldap: isServiceInstalled(ldap) || pathExists("/etc/ldap") || pathExists("/var/lib/ldap"),
    samba: isServiceInstalled(samba) || isServiceInstalled(nmbd) || pathExists("/etc/samba"),
    wireguard: isServiceInstalled(wireguard) || pathExists("/etc/wireguard"),
    docker:
      isServiceInstalled(docker) ||
      pathExists(DOCKER_APT_SOURCE_FILE) ||
      pathExists(DOCKER_APT_KEYRING_FILE) ||
      DOCKER_DATA_DIRS.some((targetPath) => pathExists(targetPath)),
    nginx: isServiceInstalled(nginx) || pathExists("/etc/nginx"),
    cockpit: isServiceInstalled(cockpit) || isServiceInstalled(cockpitSocket),
    sambaData: pathExists("/srv/samba") && dirHasEntries("/srv/samba"),
    backupScript:
      pathExists("/usr/local/bin/backup-laia.sh") ||
      pathExists("/usr/local/bin/laia-arch-backup") ||
      pathExists(BACKUP_ROOT_DIR) ||
      pathExists(BACKUP_ARCHIVE_DIR) ||
      pathExists(BACKUP_CRON_FILE),
    laiaConfig: pathExists(LAIA_HOME_DIR) || pathExists(LAIA_SUDOERS_FILE),
    ldapData: pathExists("/var/lib/ldap") && dirHasEntries("/var/lib/ldap"),
    logs: pathExists("/var/log/laia-arch"),
  };
}

export async function runGenericUninstall(services?: string[]): Promise<void> {
  const installed = await detectInstalledServices();
  const selected = normalizeSelection(services);
  const removalCommands = buildRemovalCommands();

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

    if (selectedHas(selected, "cockpit")) {
      results.push(await removeService(rl, "Cockpit", removalCommands.cockpit));
    }

    if (selectedHas(selected, "nginx")) {
      results.push(await removeService(rl, "Nginx", removalCommands.nginx));
    }

    if (selectedHas(selected, "docker")) {
      results.push(await removeService(rl, "Docker", removalCommands.docker));
    }

    if (selectedHas(selected, "wireguard")) {
      results.push(await removeService(rl, "WireGuard", removalCommands.wireguard));
    }

    if (selectedHas(selected, "samba")) {
      results.push(await removeService(rl, "Samba", removalCommands.samba));
    }

    if (selectedHas(selected, "ldap")) {
      results.push(await removeService(rl, "OpenLDAP", removalCommands.ldap));
    }

    if (selectedHas(selected, "bind9")) {
      results.push(await removeService(rl, "BIND9", removalCommands.bind9));
    }

    if (selectedHas(selected, "backups")) {
      results.push(await removeService(rl, "Backups", removalCommands.backups));
    }

    if (selectedHas(selected, "logs")) {
      results.push(await removeService(rl, "Logs de Laia Arch", removalCommands.logs));
    }

    if (selectedHas(selected, "config")) {
      results.push(
        await removeService(rl, "Configuración local de Laia Arch", removalCommands.config),
      );
    }

    const failed = results.filter((entry) => !entry.success);
    const succeeded = results.filter((entry) => entry.success);

    console.log();
    if (succeeded.length > 0) {
      console.log(
        "  " + theme.good(`Eliminado: ${succeeded.map((entry) => entry.step).join(", ")}`),
      );
    }
    if (failed.length > 0) {
      console.log(
        "  " + theme.warn(`Con incidencias: ${failed.map((entry) => entry.step).join(", ")}`),
      );
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

      const input = await ask(rl, "  Tú: ");
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
            theme.step(
              `Plan aprobado: ${services.map((entry) => SERVICE_LABELS[entry]).join(", ")}`,
            ),
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
