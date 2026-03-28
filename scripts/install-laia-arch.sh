#!/bin/bash
# Laia Arch Installer — Linux (Ubuntu/Debian/Arch/Fedora)
# Uso: curl -fsSL https://raw.githubusercontent.com/JorgeMP-3/Laia-Arch/main/scripts/install-laia-arch.sh | bash
#   o: bash scripts/install-laia-arch.sh [--dir <ruta>] [--no-symlink] [--update]
set -euo pipefail

# ── Colores ──────────────────────────────────────────────────────────────────
BOLD='\033[1m'
SUCCESS='\033[38;2;0;229;204m'
WARN='\033[38;2;255;176;32m'
ERROR='\033[38;2;230;57;70m'
INFO='\033[38;2;136;146;176m'
NC='\033[0m'

ok()   { echo -e "${SUCCESS}${BOLD}✓${NC} $*"; }
warn() { echo -e "${WARN}⚠${NC}  $*"; }
err()  { echo -e "${ERROR}✗${NC}  $*" >&2; }
info() { echo -e "${INFO}→${NC}  $*"; }
die()  { err "$*"; exit 1; }

# ── Requisitos de versión ─────────────────────────────────────────────────────
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=16
REPO_URL="https://github.com/JorgeMP-3/Laia-Arch.git"
DEFAULT_INSTALL_DIR="${HOME}/.local/share/laia-arch"
SYMLINK_DIR="${HOME}/.local/bin"

# ── Argumentos ────────────────────────────────────────────────────────────────
INSTALL_DIR="$DEFAULT_INSTALL_DIR"
CREATE_SYMLINK=1
UPDATE_MODE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dir)      INSTALL_DIR="$2"; shift 2 ;;
        --no-symlink) CREATE_SYMLINK=0; shift ;;
        --update)   UPDATE_MODE=1; shift ;;
        -h|--help)
            echo "Uso: $0 [--dir <ruta>] [--no-symlink] [--update]"
            echo ""
            echo "  --dir <ruta>    Directorio de instalación (default: ${DEFAULT_INSTALL_DIR})"
            echo "  --no-symlink    No crear symlink en ~/.local/bin/laia-arch"
            echo "  --update        Actualizar instalación existente (git pull + rebuild)"
            exit 0
            ;;
        *) die "Argumento desconocido: $1. Usa --help para ver opciones." ;;
    esac
done

# ── Verificar Node.js ─────────────────────────────────────────────────────────
check_node() {
    if ! command -v node &>/dev/null; then
        die "Node.js no encontrado. Instala Node.js >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR} (https://nodejs.org)"
    fi
    local ver
    ver="$(node --version | sed 's/v//')"
    local major minor
    major="$(echo "$ver" | cut -d. -f1)"
    minor="$(echo "$ver" | cut -d. -f2)"
    if [[ "$major" -lt "$NODE_MIN_MAJOR" ]] || \
       [[ "$major" -eq "$NODE_MIN_MAJOR" && "$minor" -lt "$NODE_MIN_MINOR" ]]; then
        die "Node.js ${ver} encontrado, se requiere >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}"
    fi
    ok "Node.js ${ver}"
}

# ── Verificar/instalar pnpm ───────────────────────────────────────────────────
check_pnpm() {
    if command -v pnpm &>/dev/null; then
        ok "pnpm $(pnpm --version)"
        return
    fi
    info "pnpm no encontrado — instalando vía npm..."
    if ! command -v npm &>/dev/null; then
        die "npm no encontrado; instala Node.js completo para obtener npm"
    fi
    npm install -g pnpm --silent --no-fund --no-audit
    ok "pnpm instalado ($(pnpm --version))"
}

# ── Verificar git ─────────────────────────────────────────────────────────────
check_git() {
    command -v git &>/dev/null || die "git no encontrado. Instálalo con: sudo apt-get install git"
    ok "git $(git --version | awk '{print $3}')"
}

# ── Clonar o actualizar el repositorio ───────────────────────────────────────
setup_repo() {
    if [[ -d "${INSTALL_DIR}/.git" ]]; then
        if [[ "$UPDATE_MODE" == "1" ]]; then
            info "Actualizando repo en ${INSTALL_DIR}..."
            git -C "$INSTALL_DIR" pull --rebase origin main
            ok "Repo actualizado"
        else
            ok "Repo ya existe en ${INSTALL_DIR} (usa --update para actualizar)"
        fi
    else
        if [[ "$UPDATE_MODE" == "1" ]]; then
            die "No hay instalación en ${INSTALL_DIR}. Ejecuta sin --update para instalar primero."
        fi
        info "Clonando repositorio desde ${REPO_URL}..."
        git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
        ok "Repo clonado en ${INSTALL_DIR}"
    fi
}

# ── Instalar dependencias ─────────────────────────────────────────────────────
install_deps() {
    info "Instalando dependencias (pnpm install)..."
    pnpm install --frozen-lockfile --prefer-offline 2>/dev/null \
        || pnpm install --prefer-offline \
        || pnpm install
    ok "Dependencias instaladas"
}

# ── Compilar ──────────────────────────────────────────────────────────────────
build() {
    info "Compilando Laia Arch..."
    bash scripts/build-laia-arch.sh
    ok "Build completado"
}

# ── Crear wrapper ejecutable ──────────────────────────────────────────────────
create_wrapper() {
    [[ "$CREATE_SYMLINK" == "0" ]] && return

    mkdir -p "$SYMLINK_DIR"

    local wrapper="${SYMLINK_DIR}/laia-arch"
    cat > "$wrapper" <<WRAPPER
#!/bin/bash
exec node "${INSTALL_DIR}/laia-arch.mjs" "\$@"
WRAPPER
    chmod +x "$wrapper"
    ok "Ejecutable creado en ${wrapper}"

    # Advertir si ~/.local/bin no está en PATH
    if [[ ":${PATH}:" != *":${SYMLINK_DIR}:"* ]]; then
        warn "${SYMLINK_DIR} no está en tu PATH."
        warn "Añade esto a tu ~/.bashrc o ~/.profile:"
        echo ""
        echo "    export PATH=\"\${HOME}/.local/bin:\${PATH}\""
        echo ""
    fi
}

# ── Verificar instalación ─────────────────────────────────────────────────────
verify() {
    local bin="${SYMLINK_DIR}/laia-arch"
    if [[ -x "$bin" ]]; then
        local ver
        ver="$("$bin" --version 2>/dev/null || node "${INSTALL_DIR}/laia-arch.mjs" --version 2>/dev/null || echo '(versión no disponible)')"
        echo ""
        echo -e "${SUCCESS}${BOLD}Laia Arch instalada correctamente${NC}"
        echo -e "  Versión:    ${ver}"
        echo -e "  Ejecutable: ${bin}"
        echo -e "  Directorio: ${INSTALL_DIR}"
        echo ""
        echo -e "  Ejecuta ${BOLD}laia-arch --help${NC} para empezar."
    else
        echo ""
        ok "Laia Arch compilada en ${INSTALL_DIR}"
        echo -e "  Ejecuta: ${BOLD}node ${INSTALL_DIR}/laia-arch.mjs --help${NC}"
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${BOLD}Laia Arch Installer${NC}"
    echo "────────────────────────────────────────"
    echo ""

    check_node
    check_pnpm
    check_git

    echo ""
    info "Directorio de instalación: ${INSTALL_DIR}"
    echo ""

    setup_repo

    cd "$INSTALL_DIR"

    install_deps
    build
    create_wrapper
    verify
}

main
