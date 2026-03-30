#!/bin/bash
# Build script para Laia Arch -- omite el canvas/A2UI que no necesitamos en servidor
set -e  # Detener si cualquier comando falla

echo "-> Actualizando versión a la fecha de hoy..."
bash scripts/bump-version-today.sh

echo "-> Compilando TypeScript..."
node scripts/tsdown-build.mjs

echo "-> Postprocesado del runtime..."
node scripts/runtime-postbuild.mjs

echo "-> Generando metadatos de CLI..."
node --import tsx scripts/write-build-info.ts
node --import tsx scripts/write-cli-startup-metadata.ts
# write-cli-compat.ts busca el bundle del daemon de OpenClaw — no necesario en Laia Arch (servidor)
# node --import tsx scripts/write-cli-compat.ts

echo "-> Copiando metadatos de hooks..."
node --import tsx scripts/copy-hook-metadata.ts

echo "-> Copiando plantillas HTML..."
node --import tsx scripts/copy-export-html-templates.ts

echo "-> Verificando artefactos..."
FAIL=0

if [[ ! -f "laia-arch.mjs" ]]; then
    echo "ERROR: laia-arch.mjs no fue generado" >&2
    FAIL=1
fi

if [[ ! -d "install-prompts" ]]; then
    echo "ERROR: install-prompts/ no existe en el directorio de instalación" >&2
    FAIL=1
elif [[ ! -f "install-prompts/00-system-context.md" ]]; then
    echo "ERROR: install-prompts/00-system-context.md no encontrado" >&2
    FAIL=1
fi

if [[ ! -d "dist" ]]; then
    echo "ERROR: dist/ no fue generado" >&2
    FAIL=1
fi

if [[ "$FAIL" -eq 1 ]]; then
    echo "" >&2
    echo "Build incompleto — revisa los errores anteriores" >&2
    exit 1
fi

echo "Build completado correctamente"
