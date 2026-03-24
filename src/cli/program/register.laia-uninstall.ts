// register.laia-uninstall.ts — Comando `laia-arch uninstall`
// IMPLEMENTACIÓN: ver src/installer/uninstaller.ts (Codex)

import type { Command } from "commander";

export function registerUninstallCommand(program: Command) {
  program
    .command("uninstall")
    .description("Desinstalar el ecosistema LAIA del servidor")
    .action(async () => {
      try {
        const { runUninstaller } = await import("../../installer/uninstaller.js");
        await runUninstaller();
      } catch (err) {
        console.error("\n  Error en el desinstalador:");
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
