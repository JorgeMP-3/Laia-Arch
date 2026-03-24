#!/bin/bash
# setup-sudoers.sh — Configura permisos sudo para Laia Arch
# Ejecutar como root: sudo bash scripts/setup-sudoers.sh

set -e
SUDOERS_FILE="/etc/sudoers.d/laia-arch"

if [ "$EUID" -ne 0 ]; then
  echo "Error: Ejecuta como root: sudo bash scripts/setup-sudoers.sh"
  exit 1
fi

echo "Configurando permisos sudo para Laia Arch..."

cat > "$SUDOERS_FILE" << 'SUDOERS'
Defaults:laia-arch !requiretty

# Sistema base
laia-arch ALL=(root) NOPASSWD: /usr/bin/hostnamectl *
laia-arch ALL=(root) NOPASSWD: /usr/bin/apt-get update
laia-arch ALL=(root) NOPASSWD: /usr/bin/apt-get install *
laia-arch ALL=(root) NOPASSWD: /usr/bin/apt-get remove *
laia-arch ALL=(root) NOPASSWD: /usr/bin/apt-get purge *

# Systemd
laia-arch ALL=(root) NOPASSWD: /bin/systemctl start *
laia-arch ALL=(root) NOPASSWD: /bin/systemctl stop *
laia-arch ALL=(root) NOPASSWD: /bin/systemctl enable *
laia-arch ALL=(root) NOPASSWD: /bin/systemctl disable *
laia-arch ALL=(root) NOPASSWD: /bin/systemctl restart *
laia-arch ALL=(root) NOPASSWD: /bin/systemctl daemon-reload

# Red y kernel
laia-arch ALL=(root) NOPASSWD: /sbin/sysctl *
laia-arch ALL=(root) NOPASSWD: /usr/sbin/ufw *

# LDAP
laia-arch ALL=(root) NOPASSWD: /usr/bin/ldapadd *
laia-arch ALL=(root) NOPASSWD: /usr/bin/ldapmodify *
laia-arch ALL=(root) NOPASSWD: /usr/bin/ldappasswd *

# Samba
laia-arch ALL=(root) NOPASSWD: /usr/bin/smbpasswd *
laia-arch ALL=(root) NOPASSWD: /bin/mkdir *
laia-arch ALL=(root) NOPASSWD: /bin/chmod *
laia-arch ALL=(root) NOPASSWD: /bin/chown *

# WireGuard
laia-arch ALL=(root) NOPASSWD: /usr/bin/wg *
laia-arch ALL=(root) NOPASSWD: /usr/bin/wg-quick *

# Docker
laia-arch ALL=(root) NOPASSWD: /usr/bin/docker *

# Archivos y scripts
laia-arch ALL=(root) NOPASSWD: /usr/bin/tee *
laia-arch ALL=(root) NOPASSWD: /usr/bin/crontab *
laia-arch ALL=(root) NOPASSWD: /bin/chmod +x /usr/local/bin/*
laia-arch ALL=(root) NOPASSWD: /usr/bin/gpg *
laia-arch ALL=(root) NOPASSWD: /usr/bin/curl *

# Prohibido explícitamente
laia-arch ALL=(root) !NOPASSWD: /usr/bin/passwd root
laia-arch ALL=(root) !NOPASSWD: /usr/sbin/deluser root
SUDOERS

visudo -c -f "$SUDOERS_FILE" && echo "✓ Sudoers válido" || {
  rm -f "$SUDOERS_FILE"
  echo "Error: Sudoers inválido"
  exit 1
}

echo ""
echo "✓ Permisos configurados. Ahora ejecuta:"
echo "  node laia-arch.mjs install"
