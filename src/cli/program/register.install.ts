// register.install.ts — Comando `laia-arch install`
// Arranca el instalador conversacional de Laia Arch.

import type { Command } from "commander";

export function registerInstallCommand(program: Command) {
  program
    .command("install")
    .description("Instalador conversacional de Laia Arch — configura el servidor completo con IA")
    .action(async () => {
      try {
        const { runInstaller } = await import("../../installer/index.js");
        await runInstaller();
      } catch (err) {
        console.error("\n  Error en el instalador:");
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
