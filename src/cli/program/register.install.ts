// register.install.ts — Comando `laia-arch install`
// Arranca el instalador conversacional de Laia Arch.

import type { Command } from "commander";

export function registerInstallCommand(program: Command) {
  program
    .command("install")
    .description("Instalador conversacional de Laia Arch — configura el servidor completo con IA")
    .option("--preset <nombre>", "Cargar una configuración guardada y saltar la conversación")
    .option("--list-presets", "Mostrar los presets de configuración disponibles")
    .action(async (opts: { preset?: string; listPresets?: boolean }) => {
      try {
        // ── Listar presets ──────────────────────────────────────────────────
        if (opts.listPresets) {
          const { printPresetList } = await import("../../installer/index.js");
          printPresetList();
          return;
        }

        // ── Cargar preset y saltar conversación ─────────────────────────────
        if (opts.preset) {
          const { loadPreset } = await import("../../installer/presets/index.js");
          const { printPresetList, runInstallerWithPreset } = await import(
            "../../installer/index.js"
          );

          const preset = loadPreset(opts.preset);
          if (!preset) {
            console.error(`\n  Preset "${opts.preset}" no encontrado.\n`);
            printPresetList();
            process.exit(1);
          }

          console.log(`\n  Usando preset: ${preset.name}`);
          console.log(`  ${preset.description}\n`);
          await runInstallerWithPreset(preset.config);
          return;
        }

        // ── Instalación conversacional normal ───────────────────────────────
        const { runInstaller } = await import("../../installer/index.js");
        await runInstaller();
      } catch (err) {
        console.error("\n  Error en el instalador:");
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
