// register.laia-uninstall.ts — Comando `laia-arch uninstall`
// Puente al CLI específico de Laia Arch.

import type { Command } from "commander";
import { registerUninstallCommand as registerLaiaUninstallCli } from "../laia-arch-uninstall-cli.js";

export function registerUninstallCommand(program: Command) {
  registerLaiaUninstallCli(program);
}
