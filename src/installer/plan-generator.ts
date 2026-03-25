// plan-generator.ts — Generación determinista del plan de instalación
// El plan se genera por código, no por la IA. La IA solo recopila la config.

import { laiaTheme as t } from "../cli/laia-arch-theme.js";
import type { InstallerConfig, InstallPlan, InstallStep } from "./types.js";

export type PlanStatus = "draft" | "approved" | "executing";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

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
      `echo "127.0.1.1 ${fqdn} ${hostname}" >> /etc/hosts`,
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
    const dnsServerIp = config.network?.serverIp ?? "127.0.0.1";

    steps.push({
      id: "dns-01",
      phase: 2,
      description: `Instalar BIND9 y configurar zona DNS para ${dnsDomain}`,
      commands: [
        "apt-get install -y bind9 bind9utils bind9-doc",
        `echo 'zone "${dnsDomain}" { type master; file "/etc/bind/db.${dnsDomain}"; };' >> /etc/bind/named.conf.local`,
        `printf '@\tIN SOA\tns1.${dnsDomain}. admin.${dnsDomain}. (1 604800 86400 2419200 604800)\n@\tIN NS\tns1.${dnsDomain}.\nns1\tIN A\t${dnsServerIp}\n' > /etc/bind/db.${dnsDomain}`,
        "systemctl enable named",
        "systemctl start named",
      ],
      requiresApproval: true,
      rollback: "apt-get remove -y --purge bind9 bind9utils && systemctl daemon-reload",
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
      'if dpkg-query -W -f=\'${Status}\' slapd 2>/dev/null | grep -q "install ok installed"; then',
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
        "systemctl enable docker",
        "systemctl start docker",
      ],
      requiresApproval: true,
      rollback:
        "apt-get remove -y --purge docker-ce docker-ce-cli containerd.io && rm -f /etc/apt/sources.list.d/docker.list",
    });
    estimatedMinutes += 12;
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
        `bash -c 'echo "0 3 * * * root rsync -a --delete /etc/ /var/backups/laia-arch/etc/ && find /var/backups/laia-arch/ -mtime +${config.compliance.backupRetentionDays} -delete" > /etc/cron.d/laia-arch-backup'`,
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
