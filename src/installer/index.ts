// index.ts — Orquestador del instalador conversacional de Laia Arch
// Fases: 0 Bootstrap → 1 Escáner → 2 Conversación → 3 Plan → 4 Credenciales → 5 Ejecución

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { isCancel, select } from "@clack/prompts";
import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import { runBootstrap } from "./bootstrap.js";
import { runConversation } from "./conversation.js";
import { provisionCredential } from "./credential-manager.js";
import { executePlan } from "./executor.js";
import { displayPlan, generatePlan } from "./plan-generator.js";
import { runScanner } from "./scanner.js";
import type { BootstrapResult, InstallerConfig, InstallMode, SystemScan } from "./types.js";

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
        t.warn("No se pudo mostrar el selector de modo. " + "Usando modo adaptativo por defecto."),
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

  try {
    execSync("sudo -n true", { stdio: "ignore", timeout: 2000 });
  } catch {
    console.log(
      t.warn(
        "\n⚠ AVISO: El usuario actual no tiene permisos sudo.\n" +
          "La instalación fallará al ejecutar comandos del sistema.\n\n" +
          "Antes de aprobar el plan, abre otro terminal y ejecuta:\n" +
          "  sudo bash scripts/setup-sudoers.sh\n" +
          "Luego vuelve aquí y aprueba el plan.\n",
      ),
    );
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
    results = await executePlan(plan);
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
}
