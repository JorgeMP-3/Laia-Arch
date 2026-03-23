// index.ts — Orquestador del instalador conversacional de Laia Arch

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runBootstrap } from "./bootstrap.js";
import { runScanner } from "./scanner.js";
import type { SystemScan, BootstrapResult } from "./types.js";

export async function runInstaller(): Promise<void> {
  let bootstrapResult: BootstrapResult;
  let systemScan: SystemScan;

  // Phase 0: configure AI provider
  try {
    bootstrapResult = await runBootstrap();
    console.log(`  Proveedor configurado: ${bootstrapResult.providerId}`);
    console.log(`  Modelo: ${bootstrapResult.model}\n`);
  } catch (err) {
    console.error("\n  Error en la Fase 0 (configuracion del proveedor):");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Phase 1: system scan
  try {
    systemScan = await runScanner();
    console.log("  Escaneo completado\n");
  } catch (err) {
    console.error("\n  Error en la Fase 1 (escaneo del sistema):");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Save scan result to ~/.laia-arch/last-scan.json
  try {
    const configDir = path.join(os.homedir(), ".laia-arch");
    fs.mkdirSync(configDir, { recursive: true });
    const scanPath = path.join(configDir, "last-scan.json");
    fs.writeFileSync(
      scanPath,
      JSON.stringify({ timestamp: new Date().toISOString(), scan: systemScan }, null, 2),
      { mode: 0o600 },
    );
    console.log(`  Escaneo guardado en: ${scanPath}\n`);
  } catch (err) {
    console.warn("  Aviso: no se pudo guardar el escaneo en disco:", String(err));
  }

  // Phases 0 and 1 complete — Phase 2 (conversation) will be built next
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║            FASES 0 Y 1 COMPLETADAS                     ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  Proveedor IA: ${bootstrapResult.providerId} / ${bootstrapResult.model}`);
  console.log(`  Servidor:     ${systemScan.os.hostname} (${systemScan.os.distribution})`);
  console.log(`  IP local:     ${systemScan.network.localIp}`);
  console.log(`\n  Fase 2 (conversacion con la IA) se construye en el proximo paso.\n`);
}
