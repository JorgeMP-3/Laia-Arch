import { isCancel, select } from "@clack/prompts";
import type { Command } from "commander";
import { runBootstrap } from "../installer/bootstrap.js";
import { runGenericUninstall, runGuidedUninstall } from "../installer/uninstaller.js";
import { laiaTheme as theme } from "./laia-arch-theme.js";

export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall")
    .description("Desinstalar el ecosistema LAIA del servidor")
    .action(async () => {
      try {
        console.log(theme.banner());
        console.log(theme.warn("Este comando elimina los servicios instalados por Laia Arch.\n"));

        const choice = await select({
          message: "¿Cómo quieres desinstalar?",
          options: [
            {
              value: "generic",
              label: "🗑 Desinstalación completa",
              hint: "Elimina todos los servicios y datos de LAIA",
            },
            {
              value: "guided",
              label: "🧠 Desinstalación guiada con IA",
              hint: "La IA te ayuda a decidir qué conservar y qué eliminar",
            },
          ],
        });

        if (isCancel(choice)) {
          console.log(theme.muted("Cancelado."));
          return;
        }

        if (choice === "generic") {
          await runGenericUninstall();
        } else {
          console.log(theme.step("Configurando proveedor de IA..."));
          const bootstrapResult = await runBootstrap();
          await runGuidedUninstall(bootstrapResult);
        }
      } catch (err) {
        console.error(theme.bad("Error:"), String(err));
        process.exit(1);
      }
    });
}
