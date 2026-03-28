// plan-generator.ts — Generación determinista del plan de instalación
//
// El plan se genera por código (NO por la IA). La IA solo recopila la config
// durante la conversación; este módulo la convierte en pasos ejecutables.
//
// Orden de fases:
//  Fase 0 — init (hostname, utilidades base)
//  Fase 1 — prep (apt update/upgrade)
//  Fase 2 — DNS (BIND9)            solo si config.services.dns
//  Fase 3 — LDAP (OpenLDAP/slapd)  solo si config.services.ldap
//  Fase 4 — Samba                   solo si config.services.samba
//  Fase 5 — WireGuard VPN          solo si config.services.wireguard
//  Fase 6 — Docker + Laia Agora    solo si config.services.docker
//  Fase 7 — Nginx                  solo si config.services.nginx
//  Fase 8 — Cockpit                solo si config.services.cockpit
//  Fase 9 — Backups rsync          solo si config.services.backups
//
// Las credenciales LDAP nunca se pasan en claro por argumentos CLI;
// se leen desde el keyring (secret-tool / macOS security) o desde
// ~/.laia-arch/credentials/ y se escriben en un fichero temporal chmod 600
// que se borra tras su uso (ver createLdapAdminPasswordFileCommand).

import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import type { InstallerConfig, InstallPlan, InstallStep } from "./types.js";

export type PlanStatus = "draft" | "approved" | "executing";

// Escapa un valor para incluirlo de forma segura dentro de comillas simples en bash.
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Devuelve value si no está vacío tras trim, o fallback en caso contrario.
function coalesceNonEmpty(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

// Genera las líneas de shell que recuperan la contraseña LDAP desde el keyring.
// Intenta en orden: secret-tool (Linux) → security (macOS) → fichero plano en
// ~/.laia-arch/credentials/. Si ninguno funciona, aborta con exit 1.
// Maneja el caso sudo: si SUDO_USER está definido, lee el keyring del usuario
// original (no de root) porque el keyring es por sesión de usuario.
function createLdapAdminPasswordLoadLines(credentialId: string): string[] {
  return [
    `LDAP_ADMIN_PASSWORD_ID=${shellQuote(credentialId)}`,
    'LDAP_ADMIN_PASSWORD=""',
    'LAIA_ARCH_CREDENTIAL_HOME="${HOME}"',
    'if [ -n "${SUDO_USER:-}" ]; then',
    '  LAIA_ARCH_CREDENTIAL_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6 || printf "%s" "$HOME")"',
    "fi",
    "if command -v secret-tool >/dev/null 2>&1; then",
    '  if [ -n "${SUDO_USER:-}" ]; then',
    '    LDAP_ADMIN_PASSWORD="$(sudo -u "$SUDO_USER" secret-tool lookup service laia-arch key "$LDAP_ADMIN_PASSWORD_ID" 2>/dev/null || true)"',
    "  else",
    '    LDAP_ADMIN_PASSWORD="$(secret-tool lookup service laia-arch key "$LDAP_ADMIN_PASSWORD_ID" 2>/dev/null || true)"',
    "  fi",
    "fi",
    'if [ -z "$LDAP_ADMIN_PASSWORD" ] && command -v security >/dev/null 2>&1; then',
    '  if [ -n "${SUDO_USER:-}" ]; then',
    '    LDAP_ADMIN_PASSWORD="$(sudo -u "$SUDO_USER" security find-generic-password -a laia-arch -s "$LDAP_ADMIN_PASSWORD_ID" -w 2>/dev/null || true)"',
    "  else",
    '    LDAP_ADMIN_PASSWORD="$(security find-generic-password -a laia-arch -s "$LDAP_ADMIN_PASSWORD_ID" -w 2>/dev/null || true)"',
    "  fi",
    "fi",
    'if [ -z "$LDAP_ADMIN_PASSWORD" ] && [ -f "$LAIA_ARCH_CREDENTIAL_HOME/.laia-arch/credentials/.$LDAP_ADMIN_PASSWORD_ID" ]; then',
    '  LDAP_ADMIN_PASSWORD="$(cat "$LAIA_ARCH_CREDENTIAL_HOME/.laia-arch/credentials/.$LDAP_ADMIN_PASSWORD_ID")"',
    "fi",
    'if [ -z "$LDAP_ADMIN_PASSWORD" ]; then',
    `  echo ${shellQuote(`No se pudo recuperar la credencial LDAP ${credentialId}.`)} >&2`,
    "  exit 1",
    "fi",
  ];
}

// Envuelve un comando ldap* en un bloque shell que:
//  1. Crea /tmp/laia-arch-ldap/ y registra un trap EXIT para limpiar
//  2. Carga la contraseña LDAP desde el keyring
//  3. La escribe en un fichero temporal con chmod 600
//  4. Ejecuta el comando pasado (que usa -y /tmp/.../admin.pwd)
//  5. Limpia el fichero al salir (trap garantiza esto incluso con error)
// Esto evita que la contraseña aparezca en ps aux, en logs o en el contexto IA.
function createLdapAdminPasswordFileCommand(credentialId: string, command: string): string {
  return [
    "set -euo pipefail",
    "mkdir -p /tmp/laia-arch-ldap",
    "cleanup() { rm -f /tmp/laia-arch-ldap/admin.pwd; }",
    "trap cleanup EXIT",
    ...createLdapAdminPasswordLoadLines(credentialId),
    "umask 077",
    'printf "%s" "$LDAP_ADMIN_PASSWORD" > /tmp/laia-arch-ldap/admin.pwd',
    "chmod 600 /tmp/laia-arch-ldap/admin.pwd",
    command,
    "cleanup",
    "trap - EXIT",
  ].join("\n");
}

// Convierte un nombre de rol libre ("Diseño Gráfico") en un nombre válido
// para LDAP/POSIX: minúsculas, sin acentos, guiones en lugar de espacios,
// solo a-z0-9_-. Fallback "usuarios" si el resultado queda vacío.
function normalizeLdapGroupName(value: string): string {
  return (
    value
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .replace(/^-+|-+$/g, "") || "usuarios"
  );
}

// Deriva un GID reproducible para un grupo LDAP a partir de su nombre.
// Usa un hash djb2 simple (hash * 31 + charCode) y lo mapea al rango 20000-39999.
// Esto garantiza que reinstalaciones con el mismo nombre de rol asignen el mismo GID,
// lo que es crítico para consistencia entre Samba y LDAP.
function deriveLdapGroupGid(name: string): number {
  let hash = 0;
  for (const char of normalizeLdapGroupName(name)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return 20_000 + (hash % 20_000);
}

/**
 * Genera un plan de instalación ordenado y reproducible a partir de la configuración
 * recopilada durante la conversación.
 * Orden lógico: preparación → red (DNS) → identidad (LDAP) → ficheros (Samba)
 * → conectividad remota (WireGuard) → contenedores (Docker) → proxy (Nginx)
 * → administración (Cockpit) → copias de seguridad (Backups)
 */
export async function generatePlan(config: InstallerConfig): Promise<InstallPlan> {
  const steps: InstallStep[] = [];
  let estimatedMinutes = 0;

  // ── Fase 0: Configuración inicial del sistema ──────────────────────────
  const hostname = config.network?.internalDomain?.split(".")[0] ?? "servidor";
  const fqdn = config.network?.internalDomain ?? `${hostname}.local`;
  const uniqueRolesFromUsers =
    config.users && config.users.length > 0
      ? [...new Set(config.users.map((u) => u.role.trim()).filter(Boolean))]
      : [];
  const uniqueRoles = uniqueRolesFromUsers.length > 0 ? uniqueRolesFromUsers : ["usuarios"];
  const roleShareFolders = uniqueRoles.map((role) => {
    const slug = role
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/^-+|-+$/g, "");
    return `/srv/samba/${slug || "usuarios"}`;
  });
  const sambaFolders = roleShareFolders.join(" ");
  const allSambaFolders = [...roleShareFolders, "/srv/samba/compartido"].join(" ");

  steps.push({
    id: "init-01",
    phase: 0,
    description: `Configurar hostname (${fqdn}) y entradas base de /etc/hosts`,
    commands: [
      `hostnamectl set-hostname ${hostname}`,
      `grep -qF '${fqdn}' /etc/hosts || echo "127.0.1.1 ${fqdn} ${hostname}" >> /etc/hosts`,
    ],
    requiresApproval: true,
    rollback: undefined,
  });

  steps.push({
    id: "init-02",
    phase: 0,
    description: "Instalar utilidades base y configurar firewall UFW",
    commands: [
      "apt-get update -qq",
      "DEBIAN_FRONTEND=noninteractive apt-get upgrade -y",
      "apt-get install -y curl wget git ufw gnupg2 ca-certificates lsb-release apt-transport-https",
    ],
    requiresApproval: true,
    rollback: undefined,
  });
  estimatedMinutes += 5;

  // ── Fase 1: Preparación del sistema ─────────────────────────────────────
  steps.push({
    id: "prep-01",
    phase: 1,
    description: "Actualizar el sistema operativo e instalar dependencias base",
    commands: [
      "apt-get update -qq",
      "DEBIAN_FRONTEND=noninteractive apt-get upgrade -y",
      "apt-get install -y curl wget gnupg2 ca-certificates lsb-release apt-transport-https",
    ],
    requiresApproval: true,
    rollback: undefined,
  });
  estimatedMinutes += 8;

  // ── Fase 2: DNS interno (BIND9) ──────────────────────────────────────────
  if (config.services.dns) {
    const dnsDomain = config.network?.internalDomain ?? `${hostname}.local`;
    const dnsServerIp = coalesceNonEmpty(config.network?.serverIp, "127.0.0.1");

    steps.push({
      id: "dns-01",
      phase: 2,
      description: `Instalar BIND9 y configurar zona DNS para ${dnsDomain}`,
      commands: [
        "apt-get install -y bind9 bind9utils bind9-doc",
        `grep -qF 'zone "${dnsDomain}"' /etc/bind/named.conf.local 2>/dev/null || echo 'zone "${dnsDomain}" { type master; file "/etc/bind/db.${dnsDomain}"; };' >> /etc/bind/named.conf.local`,
        `printf '$TTL 3600\n@\tIN SOA\tns1.${dnsDomain}. admin.${dnsDomain}. (1 604800 86400 2419200 604800)\n@\tIN NS\tns1.${dnsDomain}.\n@\tIN A\t${dnsServerIp}\nns1\tIN A\t${dnsServerIp}\n' > /etc/bind/db.${dnsDomain}`,
        "systemctl enable named",
        "systemctl start named",
      ],
      requiresApproval: true,
      rollback:
        "apt-get remove -y --purge bind9 bind9utils && rm -rf /etc/bind/db.* /etc/bind/named.conf.local && systemctl daemon-reload",
    });
    estimatedMinutes += 10;
  }

  // ── Fase 3: Directorio de identidad (OpenLDAP) ───────────────────────────
  if (config.services.ldap) {
    const ldapDomain = config.network?.internalDomain ?? `${hostname}.local`;
    const ldapDc = ldapDomain
      .split(".")
      .map((p) => `dc=${p}`)
      .join(",");
    const ldapOrganization = config.company.name.trim() || ldapDomain;
    const ldapPasswordCredentialId = "laia-arch-ldap-admin-password";
    const ldapGroupNameByRole = new Map(
      uniqueRoles.map((role) => {
        const trimmedRole = role.trim();
        return [trimmedRole, normalizeLdapGroupName(trimmedRole)];
      }),
    );
    const ldapGroupNames = [...new Set(ldapGroupNameByRole.values())];
    const ldapInstallCommand = [
      "set -euo pipefail",
      ...createLdapAdminPasswordLoadLines(ldapPasswordCredentialId),
      'SLAPD_ALREADY_INSTALLED="false"',
      "if dpkg-query -W -f='${Status}' slapd 2>/dev/null | grep -q \"install ok installed\"; then",
      '  SLAPD_ALREADY_INSTALLED="true"',
      "fi",
      `printf '%s\\n' ${shellQuote("slapd slapd/no_configuration boolean false")} | debconf-set-selections`,
      "printf '%s\\n' \"slapd slapd/internal/generated_adminpw password $LDAP_ADMIN_PASSWORD\" | debconf-set-selections",
      "printf '%s\\n' \"slapd slapd/internal/adminpw password $LDAP_ADMIN_PASSWORD\" | debconf-set-selections",
      "printf '%s\\n' \"slapd slapd/password1 password $LDAP_ADMIN_PASSWORD\" | debconf-set-selections",
      "printf '%s\\n' \"slapd slapd/password2 password $LDAP_ADMIN_PASSWORD\" | debconf-set-selections",
      `printf '%s\\n' ${shellQuote("slapd slapd/move_old_database boolean true")} | debconf-set-selections`,
      `printf '%s\\n' ${shellQuote("slapd slapd/purge_database boolean false")} | debconf-set-selections`,
      `printf '%s\\n' ${shellQuote(`slapd slapd/domain string ${ldapDomain}`)} | debconf-set-selections`,
      `printf '%s\\n' ${shellQuote(`slapd shared/organization string ${ldapOrganization}`)} | debconf-set-selections`,
      "DEBIAN_FRONTEND=noninteractive apt-get install -y slapd ldap-utils",
      'if [ "$SLAPD_ALREADY_INSTALLED" = "true" ]; then',
      "  DEBIAN_FRONTEND=noninteractive dpkg-reconfigure slapd",
      "fi",
    ].join("\n");

    steps.push({
      id: "ldap-01",
      phase: 3,
      description: "Instalar OpenLDAP (slapd) para gestión de usuarios en red",
      commands: [ldapInstallCommand, "systemctl enable slapd", "systemctl start slapd"],
      requiresApproval: true,
      rollback: "apt-get remove -y --purge slapd ldap-utils && rm -rf /etc/ldap /var/lib/ldap",
    });

    steps.push({
      id: "ldap-02",
      phase: 3,
      description: `Crear estructura LDAP para ${ldapDomain} con grupos: ${uniqueRoles.join(", ")}`,
      commands: [
        `mkdir -p /tmp/laia-arch-ldap`,
        [
          "cat <<'EOF' > /tmp/laia-arch-ldap/base.ldif",
          [
            `dn: ou=users,${ldapDc}`,
            "objectClass: organizationalUnit",
            "ou: users",
            "",
            `dn: ou=groups,${ldapDc}`,
            "objectClass: organizationalUnit",
            "ou: groups",
            "",
            ...ldapGroupNames.flatMap((groupName) => [
              `dn: cn=${groupName},ou=groups,${ldapDc}`,
              "objectClass: posixGroup",
              `cn: ${groupName}`,
              `gidNumber: ${deriveLdapGroupGid(groupName)}`,
              "",
            ]),
          ].join("\n"),
          "EOF",
        ].join("\n"),
        // Importar base.ldif en LDAP — mismo patrón que ldap-03
        createLdapAdminPasswordFileCommand(
          ldapPasswordCredentialId,
          `ldapadd -x -D "cn=admin,${ldapDc}" -y /tmp/laia-arch-ldap/admin.pwd -f /tmp/laia-arch-ldap/base.ldif`,
        ),
      ],
      requiresApproval: true,
    });

    // Generar entradas LDIF por cada usuario configurado en la conversación
    if (config.users && config.users.length > 0) {
      const userLdif = config.users
        .map((u, idx) => {
          const parts = u.username.split(".");
          const givenName = parts[0] ?? u.username;
          const sn = parts[1] ?? givenName;
          const normalizedRole = u.role.trim();
          const ldapGroupName =
            ldapGroupNameByRole.get(normalizedRole) ?? normalizeLdapGroupName(normalizedRole);
          const uidNumber = 10001 + idx;
          const gidNumber = deriveLdapGroupGid(ldapGroupName);
          return [
            `dn: uid=${u.username},ou=users,${ldapDc}`,
            "objectClass: inetOrgPerson",
            "objectClass: posixAccount",
            "objectClass: shadowAccount",
            `uid: ${u.username}`,
            `cn: ${givenName} ${sn}`,
            `sn: ${sn}`,
            `givenName: ${givenName}`,
            `uidNumber: ${uidNumber}`,
            `gidNumber: ${gidNumber}`,
            `homeDirectory: /home/${u.username}`,
            "loginShell: /bin/bash",
          ].join("\n");
        })
        .join("\n\n");

      steps.push({
        id: "ldap-03",
        phase: 3,
        description: `Crear ${config.users.length} usuario(s) en LDAP: ${config.users.map((u) => u.username).join(", ")}`,
        commands: [
          [`cat <<'EOF' > /tmp/laia-arch-ldap/users.ldif`, userLdif, "EOF"].join("\n"),
          createLdapAdminPasswordFileCommand(
            ldapPasswordCredentialId,
            `ldapadd -x -D "cn=admin,${ldapDc}" -y /tmp/laia-arch-ldap/admin.pwd -f /tmp/laia-arch-ldap/users.ldif`,
          ),
        ],
        requiresApproval: true,
      });

      const memberLdif = ldapGroupNames
        .flatMap((groupName) => {
          const usernames = config.users
            ?.filter((user) => {
              const normalizedRole = user.role.trim();
              const normalizedGroupName =
                ldapGroupNameByRole.get(normalizedRole) ?? normalizeLdapGroupName(normalizedRole);
              return normalizedGroupName === groupName;
            })
            .map((user) => user.username);
          if (!usernames || usernames.length === 0) {
            return [];
          }
          return [
            `dn: cn=${groupName},ou=groups,${ldapDc}`,
            "changetype: modify",
            "add: memberUid",
            ...usernames.map((username) => `memberUid: ${username}`),
            "",
          ];
        })
        .join("\n");

      steps.push({
        id: "ldap-04",
        phase: 3,
        description: `Añadir membresía LDAP (memberUid) para ${config.users.length} usuario(s)`,
        commands: [
          [`cat <<'EOF' > /tmp/laia-arch-ldap/members.ldif`, memberLdif, "EOF"].join("\n"),
          createLdapAdminPasswordFileCommand(
            ldapPasswordCredentialId,
            `ldapmodify -x -D "cn=admin,${ldapDc}" -y /tmp/laia-arch-ldap/admin.pwd -f /tmp/laia-arch-ldap/members.ldif`,
          ),
        ],
        requiresApproval: true,
      });

      estimatedMinutes += 5;
      estimatedMinutes += 2;
    }

    estimatedMinutes += 15;
  }

  // ── Fase 4: Carpetas compartidas (Samba) ─────────────────────────────────
  if (config.services.samba) {
    steps.push({
      id: "smb-01",
      phase: 4,
      description: "Instalar Samba para carpetas compartidas en red",
      commands: [
        "apt-get install -y samba",
        "systemctl enable smbd nmbd",
        "systemctl start smbd nmbd",
      ],
      requiresApproval: true,
      rollback: "apt-get remove -y --purge samba && systemctl daemon-reload",
    });

    steps.push({
      id: "smb-02",
      phase: 4,
      description: `Crear carpetas compartidas: ${uniqueRoles.join(", ")} + compartido`,
      commands: [
        "groupadd sambashare 2>/dev/null || true",
        `mkdir -p ${allSambaFolders}`,
        `chown -R root:sambashare ${sambaFolders}`,
        `chmod 2770 ${sambaFolders}`,
        "chmod 2775 /srv/samba/compartido",
      ],
      requiresApproval: true,
    });
    estimatedMinutes += 10;
  }

  // ── Fase 5: VPN (WireGuard) ──────────────────────────────────────────────
  if (config.services.wireguard) {
    const vpnRange = config.network?.vpnRange ?? "10.10.10.0/24";
    const vpnServerIp = vpnRange.split(".").slice(0, 3).join(".") + ".1";
    const remoteUsers = config.users?.filter((u) => u.remote) ?? [];

    steps.push({
      id: "vpn-01",
      phase: 5,
      description: `Instalar WireGuard VPN (rango: ${vpnRange})`,
      commands: [
        "apt-get install -y wireguard wireguard-tools",
        "wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key",
        "chmod 600 /etc/wireguard/server_private.key",
        `printf '[Interface]\nAddress = ${vpnServerIp}/24\nListenPort = 51820\nPrivateKey = $(cat /etc/wireguard/server_private.key)\n' > /etc/wireguard/wg0.conf`,
        "chmod 600 /etc/wireguard/wg0.conf",
      ],
      requiresApproval: true,
      rollback:
        "apt-get remove -y --purge wireguard wireguard-tools && rm -f /etc/wireguard/server_*.key /etc/wireguard/wg0.conf",
    });

    steps.push({
      id: "vpn-02",
      phase: 5,
      description: "Habilitar reenvío de paquetes IP (necesario para WireGuard)",
      commands: ["echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf", "sysctl -p /etc/sysctl.conf"],
      requiresApproval: true,
    });

    if (remoteUsers.length > 0) {
      steps.push({
        id: "vpn-03",
        phase: 5,
        description: `Generar claves WireGuard para ${remoteUsers.length} usuario(s) remoto(s): ${remoteUsers.map((u) => u.username).join(", ")}`,
        commands: remoteUsers.map(
          (u) =>
            `wg genkey | tee /etc/wireguard/peer_${u.username}_private.key | wg pubkey > /etc/wireguard/peer_${u.username}_public.key && chmod 600 /etc/wireguard/peer_${u.username}_private.key`,
        ),
        requiresApproval: true,
      });
    }

    estimatedMinutes += 15;
  }

  // ── Fase 6: Docker ───────────────────────────────────────────────────────
  if (config.services.docker) {
    steps.push({
      id: "docker-01",
      phase: 6,
      description: "Instalar Docker Engine desde el repositorio oficial",
      commands: [
        "install -m 0755 -d /etc/apt/keyrings",
        "curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc",
        "chmod a+r /etc/apt/keyrings/docker.asc",
        // shellcheck: la expansión ocurre en el shell del servidor
        `bash -c 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null'`,
        "apt-get update",
        "apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin",
        'if [ -n "${SUDO_USER:-}" ]; then usermod -aG docker "$SUDO_USER"; fi',
        "systemctl enable docker",
        "systemctl start docker",
      ],
      requiresApproval: true,
      rollback:
        "apt-get remove -y --purge docker-ce docker-ce-cli containerd.io && rm -f /etc/apt/sources.list.d/docker.list",
    });
    estimatedMinutes += 12;

    steps.push({
      id: "agora-01",
      phase: 6,
      description: "Preparar directorios persistentes y plantillas base de Laia Agora",
      commands: [
        "install -d -m 0755 /opt/laia-agora",
        "install -d -m 0755 /srv/laia-agora/config /srv/laia-agora/workspace /srv/laia-agora/templates",
        [
          "set -euo pipefail",
          'SOURCE_DIR="$(pwd)"',
          'if [ -d "$SOURCE_DIR/workspace-templates" ]; then',
          "  rm -rf /srv/laia-agora/templates/laia-arch /srv/laia-agora/templates/laia-agora /srv/laia-agora/templates/laia-nemo",
          '  cp -R "$SOURCE_DIR/workspace-templates/laia-arch" /srv/laia-agora/templates/',
          '  cp -R "$SOURCE_DIR/workspace-templates/laia-agora" /srv/laia-agora/templates/',
          '  cp -R "$SOURCE_DIR/workspace-templates/laia-nemo" /srv/laia-agora/templates/',
          "else",
          "  install -d -m 0755 /srv/laia-agora/templates/laia-arch /srv/laia-agora/templates/laia-agora /srv/laia-agora/templates/laia-nemo",
          "fi",
        ].join("\n"),
      ],
      requiresApproval: true,
      rollback: "rm -rf /opt/laia-agora /srv/laia-agora",
    });

    steps.push({
      id: "agora-02",
      phase: 6,
      description: "Generar el despliegue Docker Compose base de Laia Agora",
      commands: [
        [
          "set -euo pipefail",
          "if [ ! -f /opt/laia-agora/.env ]; then",
          '  GATEWAY_TOKEN="$(python3 -c \'import secrets, string; alphabet = string.ascii_letters + string.digits; print("".join(secrets.choice(alphabet) for _ in range(48)))\')"',
          "  cat <<EOF > /opt/laia-agora/.env",
          "OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:latest",
          "OPENCLAW_CONFIG_DIR=/srv/laia-agora/config",
          "OPENCLAW_WORKSPACE_DIR=/srv/laia-agora/workspace",
          "OPENCLAW_GATEWAY_PORT=18789",
          "OPENCLAW_BRIDGE_PORT=18790",
          "OPENCLAW_GATEWAY_BIND=lan",
          "OPENCLAW_TZ=UTC",
          "OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}",
          "EOF",
          "fi",
          "set -a",
          ". /opt/laia-agora/.env",
          "set +a",
          "if [ ! -f /srv/laia-agora/config/openclaw.json ]; then",
          "  cat <<EOF > /srv/laia-agora/config/openclaw.json",
          "{",
          '  "gateway": {',
          '    "mode": "local",',
          '    "bind": "${OPENCLAW_GATEWAY_BIND}",',
          '    "controlUi": {',
          '      "allowedOrigins": ["http://127.0.0.1:${OPENCLAW_GATEWAY_PORT}", "http://localhost:${OPENCLAW_GATEWAY_PORT}"]',
          "    }",
          "  }",
          "}",
          "EOF",
          "fi",
          "chmod 755 /srv/laia-agora/config",
          "chmod 644 /srv/laia-agora/config/openclaw.json",
        ].join("\n"),
        [
          "cat <<'EOF' > /opt/laia-agora/docker-compose.yml",
          "services:",
          "  laia-agora-gateway:",
          "    image: ${OPENCLAW_IMAGE}",
          "    environment:",
          "      HOME: /home/node",
          "      TERM: xterm-256color",
          "      OPENCLAW_GATEWAY_TOKEN: ${OPENCLAW_GATEWAY_TOKEN}",
          "      TZ: ${OPENCLAW_TZ}",
          "    volumes:",
          "      - ${OPENCLAW_CONFIG_DIR}:/home/node/.openclaw",
          "      - ${OPENCLAW_WORKSPACE_DIR}:/home/node/.openclaw/workspace",
          "    ports:",
          "      - 127.0.0.1:${OPENCLAW_GATEWAY_PORT}:18789",
          "      - 127.0.0.1:${OPENCLAW_BRIDGE_PORT}:18790",
          "    init: true",
          "    restart: unless-stopped",
          '    command: ["node", "dist/index.js", "gateway", "--allow-unconfigured", "--bind", "${OPENCLAW_GATEWAY_BIND}", "--port", "18789"]',
          "    healthcheck:",
          '      test: ["CMD", "node", "-e", "fetch(\'http://127.0.0.1:18789/healthz\').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]',
          "      interval: 30s",
          "      timeout: 5s",
          "      retries: 5",
          "      start_period: 20s",
          "EOF",
        ].join("\n"),
      ],
      requiresApproval: true,
      rollback: "rm -f /opt/laia-agora/.env /opt/laia-agora/docker-compose.yml",
    });

    steps.push({
      id: "agora-03",
      phase: 6,
      description: "Levantar Laia Agora base en Docker y validar el gateway en el puerto 18789",
      commands: [
        [
          "set -euo pipefail",
          "set -a",
          ". /opt/laia-agora/.env",
          "set +a",
          "if [ ! -f /srv/laia-agora/config/openclaw.json ]; then",
          "  cat <<EOF > /srv/laia-agora/config/openclaw.json",
          "{",
          '  "gateway": {',
          '    "mode": "local",',
          '    "bind": "${OPENCLAW_GATEWAY_BIND}",',
          '    "controlUi": {',
          '      "allowedOrigins": ["http://127.0.0.1:${OPENCLAW_GATEWAY_PORT}", "http://localhost:${OPENCLAW_GATEWAY_PORT}"]',
          "    }",
          "  }",
          "}",
          "EOF",
          "fi",
          "chmod 755 /srv/laia-agora/config",
          "chmod 644 /srv/laia-agora/config/openclaw.json",
        ].join("\n"),
        [
          "set -euo pipefail",
          "AUTH_TARGET_DIR=/srv/laia-agora/config/agents/main/agent",
          'AUTH_TARGET_PATH="${AUTH_TARGET_DIR}/auth-profiles.json"',
          'USER_HOME="${HOME}"',
          'if [ -n "${SUDO_USER:-}" ]; then',
          '  USER_HOME="$(getent passwd "${SUDO_USER}" | cut -d: -f6 || printf "%s" "${HOME}")"',
          "fi",
          'mkdir -p "${AUTH_TARGET_DIR}"',
          "for candidate in \\",
          '  "${LAIA_ARCH_AGENT_DIR:-}" \\',
          '  "${LAIA_ARCH_STATE_DIR:-}/agents/main/agent" \\',
          '  "${USER_HOME}/.openclaw/agents/main/agent" \\',
          '  "${USER_HOME}/.laia-arch/agents/main/agent"; do',
          '  [ -n "${candidate}" ] || continue',
          '  if [ -f "${candidate}/auth-profiles.json" ]; then',
          '    install -m 600 "${candidate}/auth-profiles.json" "${AUTH_TARGET_PATH}"',
          "    break",
          "  fi",
          "done",
          'if [ ! -f "${AUTH_TARGET_PATH}" ]; then',
          '  echo "ERROR: no se encontró auth-profiles.json del bootstrap para el handoff a Laia Agora" >&2',
          "  exit 1",
          "fi",
        ].join("\n"),
        "docker compose --env-file /opt/laia-agora/.env -f /opt/laia-agora/docker-compose.yml up -d",
        // El container tiene start_period: 20s — esperar hasta 90 s con reintentos de 5 s
        [
          "set -euo pipefail",
          "AGORA_URL=http://127.0.0.1:18789/healthz",
          'echo "  Esperando a que Laia Agora responda en ${AGORA_URL}..."',
          "for i in $(seq 1 18); do",
          '  if curl -fsS "$AGORA_URL" >/dev/null 2>&1; then',
          "    echo '  Laia Agora lista.'",
          "    break",
          "  fi",
          "  [ \"$i\" -eq 18 ] && { echo 'ERROR: Agora gateway no respondió tras 90 s' >&2; exit 1; }",
          "  sleep 5",
          "done",
          // Mostrar respuesta final para confirmar que es un JSON válido
          'curl -fsS "$AGORA_URL"',
        ].join("\n"),
      ],
      requiresApproval: true,
      rollback:
        "docker compose --env-file /opt/laia-agora/.env -f /opt/laia-agora/docker-compose.yml down || true",
    });
    estimatedMinutes += 8;
  }

  // ── Fase 7: Proxy inverso (Nginx) ────────────────────────────────────────
  if (config.services.nginx) {
    steps.push({
      id: "nginx-01",
      phase: 7,
      description: "Instalar Nginx como proxy inverso",
      commands: ["apt-get install -y nginx", "systemctl enable nginx", "systemctl start nginx"],
      requiresApproval: true,
      rollback: "apt-get remove -y --purge nginx nginx-common && systemctl daemon-reload",
    });
    estimatedMinutes += 5;
  }

  // ── Fase 8: Panel de administración (Cockpit) ────────────────────────────
  if (config.services.cockpit) {
    steps.push({
      id: "cockpit-01",
      phase: 8,
      description: "Instalar Cockpit (panel de administración web en el puerto 9090)",
      commands: ["apt-get install -y cockpit", "systemctl enable --now cockpit.socket"],
      requiresApproval: true,
      rollback: "apt-get remove -y --purge cockpit && systemctl daemon-reload",
    });
    estimatedMinutes += 5;
  }

  // ── Fase 9: Copias de seguridad (rsync) ──────────────────────────────────
  if (config.services.backups) {
    steps.push({
      id: "backup-01",
      phase: 9,
      description: `Configurar copias de seguridad automáticas (retención: ${config.compliance.backupRetentionDays} días)`,
      commands: [
        "apt-get install -y rsync",
        "mkdir -p /var/backups/laia-arch",
        "chmod 700 /var/backups/laia-arch",
        // Cron diario a las 3am
        `bash -c 'echo "0 3 * * * root rsync -a --delete /etc/ /var/backups/laia-arch/etc/ && find /var/backups/laia-arch/ -type f -mtime +${config.compliance.backupRetentionDays} -delete" > /etc/cron.d/laia-arch-backup'`,
        "chmod 644 /etc/cron.d/laia-arch-backup",
      ],
      requiresApproval: true,
    });
    estimatedMinutes += 5;
  }

  // ── Advertencias ────────────────────────────────────────────────────────
  const warnings: string[] = [];

  if (config.services.ldap && config.services.samba) {
    warnings.push(
      "La integración LDAP + Samba requiere configuración adicional del join de dominio. " +
        "Consulta la documentación de Samba AD DC si necesitas un dominio completo.",
    );
  }

  if (config.services.wireguard && !config.security.sshKeyOnly) {
    warnings.push(
      "WireGuard está activo pero el acceso SSH es por contraseña. " +
        "Se recomienda migrar a autenticación por clave pública.",
    );
  }

  if (config.security.internetExposed && !config.services.nginx) {
    warnings.push(
      "El servidor está expuesto a internet sin proxy inverso (Nginx no seleccionado). " +
        "Los servicios internos quedarían accesibles directamente.",
    );
  }

  if (config.compliance.gdpr && !config.services.backups) {
    warnings.push(
      "GDPR activo pero sin copias de seguridad configuradas. " +
        "La normativa puede exigir la integridad de los datos.",
    );
  }

  // ── Credenciales necesarias ───────────────────────────────────────────────
  const requiredCredentials: string[] = ["laia-arch-admin-password"];

  if (config.services.ldap) {
    requiredCredentials.push("laia-arch-ldap-admin-password");
  }
  if (config.services.samba) {
    requiredCredentials.push("laia-arch-samba-share-password");
  }
  if (config.services.wireguard) {
    requiredCredentials.push("laia-arch-wireguard-preshared-key");
  }

  return {
    steps,
    estimatedMinutes,
    warnings,
    requiredCredentials,
  };
}

/** Muestra el plan en la terminal de forma legible. */
export function displayPlan(plan: InstallPlan): void {
  console.log(t.section("PLAN DE INSTALACIÓN"));
  console.log(`\n  ${t.label("Pasos totales:")}   ${t.value(String(plan.steps.length))}`);
  console.log(`  ${t.label("Tiempo estimado:")} ${t.value(`~${plan.estimatedMinutes} minutos`)}\n`);

  let currentPhase = -1;
  for (const step of plan.steps) {
    if (step.phase !== currentPhase) {
      currentPhase = step.phase;
      console.log(`\n  ${t.brandDim("── Fase " + step.phase + " ──")}`);
    }
    const approval = step.requiresApproval ? t.dim(" [requiere aprobación]") : "";
    console.log(`    ${t.muted(step.id)}  ${t.value(step.description)}${approval}`);
  }

  if (plan.warnings.length > 0) {
    console.log();
    for (const w of plan.warnings) {
      console.log("  " + t.warn(w));
    }
  }

  if (plan.requiredCredentials.length > 0) {
    console.log(`\n  ${t.dim("Credenciales que se generarán de forma segura:")}`);
    for (const cred of plan.requiredCredentials) {
      console.log(`    ${t.brand("🔑")} ${t.muted(cred)}`);
    }
  }

  console.log();
}
