// index.ts — Orquestador del instalador conversacional de Laia Arch

import { runBootstrap } from "./bootstrap.js";
import { runScanner } from "./scanner.js";

export async function runInstaller(): Promise<void> {
  try {
    const bootstrapResult = await runBootstrap();

    console.log(`✓ Proveedor configurado: ${bootstrapResult.provider}`);
    console.log(`✓ Modelo: ${bootstrapResult.model}\n`);

    const systemScan = await runScanner();

    console.log("✓ Escaneo completado\n");
    console.log("El instalador conversacional continuará aquí en el siguiente paso.");
    console.log("(Fase 2: Conversación con la IA basada en el escaneo)");

    const scanOutput = JSON.stringify(systemScan, null, 2);
    console.log("\nDatos del escaneo (se pasarán a la IA como contexto):");
    console.log(scanOutput);
  } catch (err) {
    console.error("\n✗ Error durante la instalación:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
