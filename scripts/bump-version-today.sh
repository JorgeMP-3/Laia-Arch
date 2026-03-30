#!/bin/bash
# Helper legacy para sincronizar package.json con la fecha actual.
# Ya no forma parte del build normal de Laia Arch.
# Uso: bash scripts/bump-version-today.sh [--check]
#   --check: solo muestra la versión nueva sin modificar nada
set -euo pipefail

TODAY="$(date +%Y.%-m.%-d)"
CURRENT="$(node -p "require('./package.json').version" 2>/dev/null || echo "?")"

if [[ "${1:-}" == "--check" ]]; then
    echo "Versión actual: $CURRENT"
    echo "Versión nueva:  $TODAY"
    [[ "$CURRENT" == "$TODAY" ]] && echo "Ya está al día." || echo "Necesita actualización."
    exit 0
fi

if [[ "$CURRENT" == "$TODAY" ]]; then
    echo "Versión ya es $TODAY — sin cambios."
    exit 0
fi

# Reemplazar en package.json usando node para preservar el formato JSON
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$TODAY';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('Versión actualizada: ' + '$CURRENT' + ' → ' + '$TODAY');
"
