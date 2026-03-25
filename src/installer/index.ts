// index.ts — Orquestador del instalador conversacional de Laia Arch
// Fases: 0 Bootstrap → 1 Escáner → 2 Conversación → 3 Plan → 4 Credenciales → 5 Ejecución

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { isCancel, select } from "@clack/prompts";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import { runBootstrap } from "./bootstrap.js";
import { runConversation } from "./conversation.js";
import { provisionCredential } from "./credential-manager.js";
import {
  askSudoPassword,
  checkSudoPasswordless,
  executePlan,
  revokeSudoers,
  setupSudoers,
  validateSudoPassword,
} from "./executor.js";
import { displayPlan, generatePlan } from "./plan-generator.js";
import { listPresets, savePreset } from "./presets/index.js";
import { runScanner } from "./scanner.js";
import type { BootstrapResult, InstallerConfig, InstallMode, SystemScan } from "./types.js";

// ── PASO 0: Configurar sudo al arrancar ───────────────────────────────────────

/**
 * Solicita y configura el acceso sudo antes de cualquier otra fase.
 * Si ya hay NOPASSWD activo, devuelve "" sin pedir contraseña.
 * Si no, pide la contraseña, valida, escribe /etc/sudoers.d/laia-arch
 * y devuelve la contraseña para usarla en la revocación al terminar.
 */
async function initializeSudo(): Promise<string> {
  const passwordless = await checkSudoPasswordless();
  if (passwordless) {
    console.log(`  ${t.good("✓ Acceso sudo sin contraseña disponible.")}\n`);
    return "";
  }

  console.log(`  ${t.warn("Se necesita la contraseña de administrador (sudo)")}`);
  console.log(
    `  ${t.muted("El instalador la usará para configurar sus permisos y no la almacenará.\n")}`,
  );

  let sudoPassword = "";
  let configured = false;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt =
      attempt === 1
        ? `  Contraseña sudo para ${process.env["USER"] ?? "root"}: `
        : `  Contraseña incorrecta, intento ${attempt}/3: `;

    const candidate = await askSudoPassword(prompt);
    if (!candidate) {
      console.log(`  ${t.warn("Contraseña vacía — cancelado.")}`);
      break;
    }

    process.stdout.write(`  ${t.muted("Verificando...")}`);
    const valid = await validateSudoPassword(candidate);
    process.stdout.write("\r  \r");

    if (!valid) continue;

    console.log(`  ${t.good("✓ Contraseña verificada. Configurando permisos...")}`);
    const result = await setupSudoers(candidate);

    if (result.ok) {
      console.log(`  ${t.good("✓ Permisos configurados correctamente.")}\n`);
      sudoPassword = candidate;
      configured = true;
      break;
    } else {
      console.log(`  ${t.warn("Error al configurar permisos: " + result.message)}`);
      console.log(
        `  ${t.muted("Puedes ejecutar manualmente: sudo bash scripts/setup-sudoers.sh\n")}`,
      );
      break;
    }
  }

  if (!sudoPassword && !configured) {
    const cont = await askConfirmation(
      "No se pudo configurar sudo. ¿Continuar de todas formas? (los pasos del sistema pueden fallar)",
    );
    if (!cont) process.exit(0);
  }

  return sudoPassword;
}

// ── PASO 8: Ofrecer revocar permisos sudo al terminar ─────────────────────────

async function offerRevokeSudo(sudoPassword: string): Promise<void> {
  console.log(`\n  ${t.warn("Los permisos de administrador de Laia Arch están activos.")}`);
  console.log(`  ¿Qué quieres hacer con ellos?\n`);
  console.log(`  ${t.label("1. Mantener")} — Laia Arch podrá ejecutar comandos si se reactiva`);
  console.log(
    `  ${t.label("2. Revocar")}  — Eliminar los permisos ahora (recomendado si la instalación ha terminado)\n`,
  );

  const revoke = await askConfirmation("¿Revocar los permisos sudo ahora?");
  if (!revoke) {
    console.log(
      `  ${t.muted("Permisos mantenidos. Para reactivar Laia Arch ejecuta: laia-arch install")}\n`,
    );
    return;
  }

  const password = sudoPassword || (await askSudoPassword("  Contraseña sudo para revocar: "));
  if (!password) {
    console.log(`  ${t.warn("No se pudo revocar: contraseña vacía.")}\n`);
    return;
  }

  const result = await revokeSudoers(password);
  if (result.ok) {
    console.log(`  ${t.good("✓ Permisos revocados correctamente.")}\n`);
  } else {
    console.log(`  ${t.warn("No se pudo revocar: " + result.message)}\n`);
  }
}

/** Pide un texto al usuario. */
async function askText(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question(`  ${prompt}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Ofrece guardar la configuración actual como preset.
 * No es bloqueante: si el usuario rechaza, simplemente continúa.
 */
async function offerSavePreset(config: InstallerConfig): Promise<void> {
  const save = await askConfirmation(
    "¿Quieres guardar esta configuración como preset para futuras instalaciones?",
  );
  if (!save) return;

  const name = await askText("Nombre del preset (p.ej. empresa-base)");
  if (!name) {
    console.log("  " + t.muted("Nombre vacío, no se guardó el preset.\n"));
    return;
  }
  const description = await askText("Descripción breve (opcional, Enter para omitir)");

  try {
    const filePath = savePreset(name, description || name, config);
    console.log("\n  " + t.good(`Preset guardado en: ${filePath}`));
    console.log("  " + t.muted(`Para usarlo: laia-arch install --preset "${name}"\n`));
  } catch (err) {
    console.warn("  " + t.warn("No se pudo guardar el preset: " + String(err)));
  }
}

/** Pide una confirmación explícita al usuario antes de continuar. */
async function askConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question(`  ${question} (s/n): `, (answer) => {
      rl.close();
      const norm = answer.toLowerCase().trim();
      resolve(norm === "s" || norm === "si" || norm === "sí" || norm === "y" || norm === "yes");
    });
  });
}

export async function runInstaller(): Promise<void> {
  let bootstrapResult: BootstrapResult;
  let systemScan: SystemScan;
  let config: InstallerConfig;

  // ── Paso 0: Configurar sudo ───────────────────────────────────────────────
  const sudoPassword = await initializeSudo();

  // ── Fase 0: Configurar proveedor IA ──────────────────────────────────────
  try {
    bootstrapResult = await runBootstrap();
    console.log(
      "  " + t.good(`Proveedor: ${bootstrapResult.providerId} / ${bootstrapResult.model}\n`),
    );
  } catch (err) {
    console.error("\n  Error en Fase 0 (proveedor IA):");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // ── Fase 1: Escaneo del sistema ───────────────────────────────────────────
  try {
    systemScan = await runScanner();
    console.log("  " + t.good("Escaneo completado.\n"));
  } catch (err) {
    console.error("\n  Error en Fase 1 (escaneo del sistema):");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Guardar escaneo en ~/.laia-arch/last-scan.json
  try {
    const configDir = path.join(os.homedir(), ".laia-arch");
    fs.mkdirSync(configDir, { recursive: true });
    const scanPath = path.join(configDir, "last-scan.json");
    fs.writeFileSync(
      scanPath,
      JSON.stringify({ timestamp: new Date().toISOString(), scan: systemScan }, null, 2),
      { mode: 0o600 },
    );
  } catch {
    console.warn("  Aviso: no se pudo guardar el escaneo en disco.");
  }

  // ── Selección de modo ─────────────────────────────────────────────────────
  let installMode: InstallMode = "adaptive";
  try {
    const modeChoice = await select({
      message: "¿Cómo quieres instalar el ecosistema LAIA?",
      options: [
        {
          value: "tool-driven",
          label: "⚡ Automático",
          hint: "La IA hace preguntas mínimas y ejecuta todo con herramientas. Rápido.",
        },
        {
          value: "guided",
          label: "🗺 Asistido",
          hint: "La IA sigue una guía fija de preguntas. Siempre el mismo camino.",
        },
        {
          value: "adaptive",
          label: "🧠 Adaptativo",
          hint: "La IA adapta la instalación según tu empresa. Camino personalizado.",
        },
      ],
    });
    if (isCancel(modeChoice)) {
      console.log("\n  " + t.warn("Instalación cancelada."));
      process.exit(0);
    }
    installMode = modeChoice as InstallMode;
  } catch (err) {
    console.log(
      "\n  " +
        t.warn("No se pudo mostrar el selector de modo. Usando modo adaptativo por defecto."),
    );
    if (err instanceof Error) {
      console.log("  " + t.muted(err.message));
    }
    // installMode ya es "adaptive" por defecto
  }

  // ── Fase 2: Conversación con la IA ───────────────────────────────────────
  try {
    config = await runConversation(bootstrapResult, systemScan, installMode);
  } catch (err) {
    console.error("\n  Error en Fase 2 (conversación):");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // ── Fase 3: Generar el plan ───────────────────────────────────────────────
  let plan;
  try {
    plan = await generatePlan(config);
    displayPlan(plan);
  } catch (err) {
    console.error("\n  Error generando el plan de instalación:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Confirmación explícita antes de continuar con la ejecución
  const confirmed = await askConfirmation(
    "¿Apruebas este plan y quieres continuar con la instalación?",
  );
  if (!confirmed) {
    console.log(
      "\n  Instalación cancelada. El plan ha sido guardado en ~/.laia-arch/installer-config.json",
    );
    process.exit(0);
  }

  // ── Guardar preset (opcional) ─────────────────────────────────────────────
  await offerSavePreset(config);

  // ── Fase 4: Generar credenciales de forma segura ─────────────────────────
  console.log(t.section("FASE 4 — GENERACIÓN DE CREDENCIALES"));
  console.log(t.dim("\n  Las siguientes contraseñas se generan ahora y se almacenan"));
  console.log(t.dim("  de forma segura. NUNCA pasan por el contexto de la IA.\n"));

  const passwordComplexityLength: Record<string, number> = {
    basic: 16,
    medium: 24,
    high: 32,
  };
  const pwLength = passwordComplexityLength[config.security.passwordComplexity] ?? 24;

  try {
    for (const credId of plan.requiredCredentials) {
      await provisionCredential(credId, credId.replace(/^laia-arch-/, "").replace(/-/g, " "), {
        length: pwLength,
        symbols: config.security.passwordComplexity !== "basic",
      });
      console.log();
    }
  } catch (err) {
    console.error("\n  Error generando credenciales:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const readyToExecute = await askConfirmation(
    "¿Has guardado todas las contraseñas? ¿Listo para ejecutar la instalación?",
  );
  if (!readyToExecute) {
    console.log("\n  Instalación pospuesta. Ejecuta 'laia-arch install' cuando estés listo.");
    process.exit(0);
  }

  // ── Fase 5: Ejecutar el plan ──────────────────────────────────────────────
  let results;
  try {
    results = await executePlan(plan, { bootstrap: bootstrapResult });
  } catch (err) {
    console.error("\n  Error durante la ejecución:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const failed = results.filter((r) => r.status === "failed" || r.status === "skipped").length;
  if (failed > 0) {
    console.error(`\n  La instalación terminó con ${failed} pasos fallidos o rechazados.`);
    process.exit(1);
  }

  console.log(t.section("INSTALACIÓN COMPLETADA"));
  console.log(`\n  ${t.label("Servidor:")} ${t.value(systemScan.os.hostname)}`);
  console.log(
    `  ${t.label("Sistema: ")} ${t.value(`${systemScan.os.distribution} ${systemScan.os.version}`)}`,
  );
  console.log(`  ${t.label("IP local:")} ${t.value(systemScan.network.localIp)}\n`);
  console.log("  " + t.good("Laia Arch ha terminado su trabajo."));
  console.log(t.dim("  Lo que construyó queda.\n"));

  // ── Paso 8: Ofrecer revocar sudo ────────────────────────────────────────
  await offerRevokeSudo(sudoPassword);
}

// ── Ejecución con preset (salta la Fase 2) ────────────────────────────────────

/**
 * Ejecuta el instalador partiendo de una InstallerConfig ya cargada.
 * Realiza bootstrap (Fase 0) y escaneo (Fase 1) igualmente, luego
 * salta directamente a la Fase 3 (generación del plan).
 */
export async function runInstallerWithPreset(config: InstallerConfig): Promise<void> {
  let bootstrapResult: BootstrapResult;
  let systemScan: SystemScan;

  // ── Paso 0: Configurar sudo ───────────────────────────────────────────────
  const sudoPassword = await initializeSudo();

  // ── Fase 0: Configurar proveedor IA ──────────────────────────────────────
  try {
    bootstrapResult = await runBootstrap();
    console.log(
      "  " + t.good(`Proveedor: ${bootstrapResult.providerId} / ${bootstrapResult.model}\n`),
    );
  } catch (err) {
    console.error("\n  Error en Fase 0 (proveedor IA):");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // ── Fase 1: Escaneo del sistema ───────────────────────────────────────────
  try {
    systemScan = await runScanner();
    console.log("  " + t.good("Escaneo completado.\n"));
  } catch (err) {
    console.error("\n  Error en Fase 1 (escaneo del sistema):");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log("  " + t.muted("Fase 2 (conversación) omitida — usando preset.\n"));

  // ── Fase 3: Generar el plan ───────────────────────────────────────────────
  let plan;
  try {
    plan = await generatePlan(config);
    displayPlan(plan);
  } catch (err) {
    console.error("\n  Error generando el plan de instalación:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const confirmed = await askConfirmation(
    "¿Apruebas este plan y quieres continuar con la instalación?",
  );
  if (!confirmed) {
    console.log("\n  Instalación cancelada.");
    process.exit(0);
  }

  // ── Fase 4: Generar credenciales de forma segura ─────────────────────────
  console.log(t.section("FASE 4 — GENERACIÓN DE CREDENCIALES"));
  console.log(t.dim("\n  Las siguientes contraseñas se generan ahora y se almacenan"));
  console.log(t.dim("  de forma segura. NUNCA pasan por el contexto de la IA.\n"));

  const passwordComplexityLength: Record<string, number> = {
    basic: 16,
    medium: 24,
    high: 32,
  };
  const pwLength = passwordComplexityLength[config.security.passwordComplexity] ?? 24;

  try {
    for (const credId of plan.requiredCredentials) {
      await provisionCredential(credId, credId.replace(/^laia-arch-/, "").replace(/-/g, " "), {
        length: pwLength,
        symbols: config.security.passwordComplexity !== "basic",
      });
      console.log();
    }
  } catch (err) {
    console.error("\n  Error generando credenciales:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const readyToExecute = await askConfirmation(
    "¿Has guardado todas las contraseñas? ¿Listo para ejecutar la instalación?",
  );
  if (!readyToExecute) {
    console.log("\n  Instalación pospuesta. Ejecuta 'laia-arch install' cuando estés listo.");
    process.exit(0);
  }

  // ── Fase 5: Ejecutar el plan ──────────────────────────────────────────────
  let results;
  try {
    results = await executePlan(plan, { bootstrap: bootstrapResult });
  } catch (err) {
    console.error("\n  Error durante la ejecución:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const failed = results.filter((r) => r.status === "failed" || r.status === "skipped").length;
  if (failed > 0) {
    console.error(`\n  La instalación terminó con ${failed} pasos fallidos o rechazados.`);
    process.exit(1);
  }

  console.log(t.section("INSTALACIÓN COMPLETADA"));
  console.log(`\n  ${t.label("Servidor:")} ${t.value(systemScan.os.hostname)}`);
  console.log(
    `  ${t.label("Sistema: ")} ${t.value(`${systemScan.os.distribution} ${systemScan.os.version}`)}`,
  );
  console.log(`  ${t.label("IP local:")} ${t.value(systemScan.network.localIp)}\n`);
  console.log("  " + t.good("Laia Arch ha terminado su trabajo."));
  console.log(t.dim("  Lo que construyó queda.\n"));

  // ── Paso 8: Ofrecer revocar sudo ────────────────────────────────────────
  await offerRevokeSudo(sudoPassword);
}

/** Muestra la lista de presets disponibles en consola. */
export function printPresetList(): void {
  const presets = listPresets();
  if (presets.length === 0) {
    console.log("\n  " + t.muted("No hay presets disponibles."));
    console.log(
      "  " +
        t.muted(
          "Los presets de usuario se crean al final de una instalación. " +
            "Ejecuta 'laia-arch install' y guarda la configuración cuando se te ofrezca.\n",
        ),
    );
    return;
  }
  console.log("\n  Presets disponibles:\n");
  for (const p of presets) {
    const date = new Date(p.createdAt).toLocaleDateString("es-ES");
    const tag = p.source === "repo" ? t.dim(" [predefinido]") : t.dim(" [guardado]");
    console.log(`  ${t.label(p.name)}${tag}`);
    console.log(`    ${t.muted(p.description)}`);
    console.log(`    ${t.dim("Creado: " + date)}\n`);
  }
}
