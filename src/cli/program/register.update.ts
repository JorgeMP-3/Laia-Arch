// register.update.ts — Comando `laia-arch update`
// Actualización de Laia Arch y mejoras del ecosistema con IA.

import type { Command } from "commander";

export function registerUpdateCommand(program: Command) {
  program
    .command("update")
    .description("Actualizar Laia Arch o mejorar el ecosistema instalado")
    .action(async () => {
      try {
        const { runUpdater } = await import("../../installer/updater.js");
        await runUpdater();
      } catch (err) {
        console.error("\n  Error en el actualizador:");
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
