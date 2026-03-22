#!/bin/bash
# Build script para Laia Arch -- omite el canvas/A2UI que no necesitamos en servidor
set -e  # Detener si cualquier comando falla

echo "-> Compilando TypeScript..."
node scripts/tsdown-build.mjs

echo "-> Postprocesado del runtime..."
node scripts/runtime-postbuild.mjs

echo "-> Generando metadatos de CLI..."
node --import tsx scripts/write-build-info.ts
node --import tsx scripts/write-cli-startup-metadata.ts
node --import tsx scripts/write-cli-compat.ts

echo "-> Copiando metadatos de hooks..."
node --import tsx scripts/copy-hook-metadata.ts

echo "-> Copiando plantillas HTML..."
node --import tsx scripts/copy-export-html-templates.ts

echo "Build completado correctamente"
