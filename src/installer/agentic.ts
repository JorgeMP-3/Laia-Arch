// agentic.ts — Capa de transformación entre config/plan y estructuras agénticas
//
// Este archivo NO ejecuta nada ni llama a la IA. Su función es construir los
// objetos semánticos que el executor necesita para operar:
//
//  buildConversationIntent()      → crea el ConversationIntent a partir de una
//                                   InstallerConfig (útil cuando se usa preset
//                                   y se salta la Fase 2 de conversación)
//
//  buildActionProposalsFromPlan() → convierte los InstallStep del plan en
//                                   ActionProposal enriquecidos (con verificación
//                                   esperada, archivos tocados y servicios afectados)
//
//  createInstallSessionState()    → inicializa el InstallSessionState vacío que
//                                   el executor irá rellenando durante la ejecución

import type {
  ActionProposal,
  ConversationContradiction,
  ConversationFact,
  ConversationGap,
  ConversationIntent,
  InstallMode,
  InstallPlan,
  InstallSessionState,
  InstallStep,
  InstallerConfig,
  ServiceSelection,
  SystemScan,
} from "./types.js";

// Devuelve la lista de servicios habilitados en la config (solo los que son true).
function listDesiredServices(services: ServiceSelection): Array<keyof ServiceSelection> {
  return Object.entries(services)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name as keyof ServiceSelection);
}

// Construye hechos confirmados a partir de la InstallerConfig estructurada.
// No analiza lenguaje natural; solo traduce campos de config a ConversationFact.
function buildConversationFacts(config: InstallerConfig, scan?: SystemScan): ConversationFact[] {
  const facts: ConversationFact[] = [
    {
      key: "company.name",
      value: config.company.name,
      confidence: "confirmed",
      source: "user",
    },
    {
      key: "company.sector",
      value: config.company.sector,
      confidence: "confirmed",
      source: "user",
    },
    {
      key: "access.roles",
      value: config.access.roles.map((role) => `${role.name}:${role.count}`).join(", "),
      confidence: "confirmed",
      source: "user",
    },
    {
      key: "access.remoteUsers",
      value: String(config.access.remoteUsers),
      confidence: "confirmed",
      source: "user",
    },
    {
      key: "services.enabled",
      value: listDesiredServices(config.services).join(", "),
      confidence: "inferred",
      source: "inferred",
    },
    {
      key: "network.internalDomain",
      value: config.network?.internalDomain ?? "(unset)",
      confidence: config.network ? "confirmed" : "uncertain",
      source: config.network ? "user" : "default",
    },
  ];

  if (scan) {
    facts.push(
      {
        key: "scan.os",
        value: `${scan.os.distribution} ${scan.os.version}`,
        confidence: "confirmed",
        source: "scan",
      },
      {
        key: "scan.localIp",
        value: scan.network.localIp,
        confidence: "confirmed",
        source: "scan",
      },
    );
  }

  return facts;
}

// Genera frases de decisión legibles (para logs y contexto de reparación).
// Explican por qué ciertos servicios están activos/desactivados.
function buildConversationDecisions(config: InstallerConfig): string[] {
  const decisions = [
    `Install mode: ${config.installMode ?? "adaptive"}.`,
    config.access.remoteUsers > 0
      ? "WireGuard should remain enabled because remote users were requested."
      : "WireGuard can stay disabled if remote access is not needed.",
    config.services.docker
      ? "Docker remains enabled to support Agora base deployment."
      : "Docker was disabled explicitly in the current configuration.",
  ];

  if (config.security.sshKeyOnly) {
    decisions.push("SSH access is restricted to keys only.");
  }

  return decisions;
}

export function buildConversationIntent(
  config: InstallerConfig,
  mode: InstallMode,
  transcript: string[],
  scan?: SystemScan,
): ConversationIntent {
  const desiredServices = listDesiredServices(config.services);
  const summary = [
    `${config.company.name} (${config.company.sector})`,
    `${config.access.totalUsers} users`,
    desiredServices.join(", ") || "no services selected",
    config.access.remoteUsers > 0
      ? `${config.access.remoteUsers} remote users`
      : "local-only access",
  ].join(" | ");

  const pendingGaps: ConversationGap[] = [];
  if (!config.users || config.users.length === 0) {
    pendingGaps.push({
      key: "users.named",
      description: "Named LDAP users are still undefined.",
      blocking: false,
      suggestedDefault: [],
    });
  }
  if (!config.network?.internalDomain) {
    pendingGaps.push({
      key: "network.internalDomain",
      description: "The internal domain has not been confirmed.",
      blocking: true,
    });
  }

  const contradictions: ConversationContradiction[] = [];
  if (config.access.remoteUsers > 0 && !config.services.wireguard) {
    contradictions.push({
      key: "services.wireguard",
      firstStatement: "Remote users were requested.",
      laterStatement: "WireGuard is disabled in the selected services.",
      resolution: "Enable WireGuard before execution or accept a local-only deployment.",
    });
  }

  return {
    mode,
    summary,
    goal: {
      companyName: config.company.name,
      installMode: mode,
      targetHostname: scan?.os.hostname ?? config.company.name.toLowerCase(),
      targetDomain: config.network?.internalDomain ?? `${config.company.name.toLowerCase()}.local`,
      desiredServices,
      remoteAccessRequired: config.access.remoteUsers > 0,
      desiredUsers: config.users ?? [],
    },
    confirmedFacts: buildConversationFacts(config, scan),
    pendingGaps,
    contradictions,
    decisions: buildConversationDecisions(config),
    installerConfig: config,
    conversationMessages: transcript.map((line) => {
      const separator = line.indexOf(": ");
      const role = line.slice(0, separator) === "assistant" ? "assistant" : "user";
      return {
        role,
        content: separator >= 0 ? line.slice(separator + 2) : line,
      };
    }),
    completedAt: new Date().toISOString(),
  };
}

// Infiere qué servicio systemd toca un step basándose en su prefijo de id.
// Ej: "ldap-02" → ["slapd"], "agora-03" → ["docker"]
function deriveServicesTouched(stepId: string): string[] {
  if (stepId.startsWith("dns-")) {
    return ["bind9"];
  }
  if (stepId.startsWith("ldap-")) {
    return ["slapd"];
  }
  if (stepId.startsWith("smb-") || stepId.startsWith("samba-")) {
    return ["smbd", "nmbd"];
  }
  if (stepId.startsWith("vpn-") || stepId.startsWith("wireguard-")) {
    return ["wg-quick@wg0"];
  }
  if (stepId.startsWith("docker-")) {
    return ["docker"];
  }
  if (stepId.startsWith("nginx-")) {
    return ["nginx"];
  }
  if (stepId.startsWith("cockpit-")) {
    return ["cockpit.socket"];
  }
  if (stepId.startsWith("backup-")) {
    return ["cron"];
  }
  if (stepId.startsWith("agora-")) {
    return ["docker"];
  }
  return [];
}

// Extrae rutas de archivo que aparecen en los comandos del step.
// Solo captura rutas bajo prefijos de sistema relevantes (/etc/, /srv/, /opt/, etc.)
// para que el executor sepa qué archivos potencialmente cambió el paso.
function deriveChangedFiles(stepCommands: string[]): string[] {
  const interestingPrefixes = ["/etc/", "/srv/", "/opt/", "/var/backups/", "/usr/local/bin/"];
  const changed = new Set<string>();
  for (const command of stepCommands) {
    for (const match of command.matchAll(/\/[A-Za-z0-9._/-]+/g)) {
      const candidate = match[0];
      if (interestingPrefixes.some((prefix) => candidate.startsWith(prefix))) {
        changed.add(candidate);
      }
    }
  }
  return [...changed];
}

function normalizeRoleSlug(roleName: string): string {
  return (
    roleName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/^-+|-+$/g, "") || "usuarios"
  );
}

// Reutilidades del camino agentic directo. Replican la lógica necesaria del
// plan determinista actual, pero construyendo pasos/propuestas desde la
// intención estructurada en lugar de depender de plan-generator.ts.
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function coalesceNonEmpty(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
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

function buildAdaptiveInstallPlanArtifacts(
  intent: ConversationIntent,
  scan?: SystemScan,
): {
  steps: InstallStep[];
  estimatedMinutes: number;
  warnings: string[];
  requiredCredentials: string[];
} {
  const config = intent.installerConfig;
  const steps: InstallStep[] = [];
  let estimatedMinutes = 0;

  const hostname = coalesceNonEmpty(
    intent.goal.targetHostname,
    scan?.os.hostname ?? config.network?.internalDomain?.split(".")[0] ?? "servidor",
  );
  const fqdn = coalesceNonEmpty(
    intent.goal.targetDomain,
    config.network?.internalDomain ?? `${hostname}.local`,
  );
  const uniqueRolesFromUsers =
    config.users && config.users.length > 0
      ? [...new Set(config.users.map((u) => u.role.trim()).filter(Boolean))]
      : [];
  const uniqueRoles = uniqueRolesFromUsers.length > 0 ? uniqueRolesFromUsers : ["usuarios"];
  const roleShareFolders = uniqueRoles.map((role) => `/srv/samba/${normalizeRoleSlug(role)}`);
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

  if (config.services.dns) {
    const dnsDomain = coalesceNonEmpty(intent.goal.targetDomain, `${hostname}.local`);
    const dnsServerIp = coalesceNonEmpty(
      config.network?.serverIp,
      scan?.network.localIp ?? "127.0.0.1",
    );

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

  if (config.services.ldap) {
    const ldapDomain = coalesceNonEmpty(intent.goal.targetDomain, `${hostname}.local`);
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
        "mkdir -p /tmp/laia-arch-ldap",
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
        createLdapAdminPasswordFileCommand(
          ldapPasswordCredentialId,
          `ldapadd -x -D "cn=admin,${ldapDc}" -y /tmp/laia-arch-ldap/admin.pwd -f /tmp/laia-arch-ldap/base.ldif`,
        ),
      ],
      requiresApproval: true,
    });

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
          ["cat <<'EOF' > /tmp/laia-arch-ldap/users.ldif", userLdif, "EOF"].join("\n"),
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
          ["cat <<'EOF' > /tmp/laia-arch-ldap/members.ldif", memberLdif, "EOF"].join("\n"),
          createLdapAdminPasswordFileCommand(
            ldapPasswordCredentialId,
            `ldapmodify -x -D "cn=admin,${ldapDc}" -y /tmp/laia-arch-ldap/admin.pwd -f /tmp/laia-arch-ldap/members.ldif`,
          ),
        ],
        requiresApproval: true,
      });

      estimatedMinutes += 7;
    }

    estimatedMinutes += 15;
  }

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

  if (config.services.wireguard) {
    const vpnRange = config.network?.vpnRange ?? "10.10.10.0/24";
    const vpnServerIp = `${vpnRange.split(".").slice(0, 3).join(".")}.1`;
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

  if (config.services.docker) {
    steps.push({
      id: "docker-01",
      phase: 6,
      description: "Instalar Docker Engine desde el repositorio oficial",
      commands: [
        "install -m 0755 -d /etc/apt/keyrings",
        "curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc",
        "chmod a+r /etc/apt/keyrings/docker.asc",
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
        "docker compose --env-file /opt/laia-agora/.env -f /opt/laia-agora/docker-compose.yml up -d",
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
          'curl -fsS "$AGORA_URL"',
        ].join("\n"),
      ],
      requiresApproval: true,
      rollback:
        "docker compose --env-file /opt/laia-agora/.env -f /opt/laia-agora/docker-compose.yml down || true",
    });
    estimatedMinutes += 8;
  }

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

  if (config.services.backups) {
    steps.push({
      id: "backup-01",
      phase: 9,
      description: `Configurar copias de seguridad automáticas (retención: ${config.compliance.backupRetentionDays} días)`,
      commands: [
        "apt-get install -y rsync",
        "mkdir -p /var/backups/laia-arch",
        "chmod 700 /var/backups/laia-arch",
        `bash -c 'echo "0 3 * * * root rsync -a --delete /etc/ /var/backups/laia-arch/etc/ && find /var/backups/laia-arch/ -type f -mtime +${config.compliance.backupRetentionDays} -delete" > /etc/cron.d/laia-arch-backup'`,
        "chmod 644 /etc/cron.d/laia-arch-backup",
      ],
      requiresApproval: true,
    });
    estimatedMinutes += 5;
  }

  const warnings: string[] = [];
  if (config.services.ldap && config.services.samba) {
    warnings.push(
      "La integración LDAP + Samba requiere configuración adicional del join de dominio. Consulta la documentación de Samba AD DC si necesitas un dominio completo.",
    );
  }
  if (config.services.wireguard && !config.security.sshKeyOnly) {
    warnings.push(
      "WireGuard está activo pero el acceso SSH es por contraseña. Se recomienda migrar a autenticación por clave pública.",
    );
  }
  if (config.security.internetExposed && !config.services.nginx) {
    warnings.push(
      "El servidor está expuesto a internet sin proxy inverso (Nginx no seleccionado). Los servicios internos quedarían accesibles directamente.",
    );
  }
  if (config.compliance.gdpr && !config.services.backups) {
    warnings.push(
      "GDPR activo pero sin copias de seguridad configuradas. La normativa puede exigir la integridad de los datos.",
    );
  }

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

export function buildAdaptiveExecutionPlanFromIntent(
  intent: ConversationIntent,
  scan?: SystemScan,
): InstallPlan {
  return buildAdaptiveInstallPlanArtifacts(intent, scan);
}

// Devuelve los VerificationRequirement que el executor debe comprobar
// después de ejecutar un step. La lógica es determinista por prefijo de id:
//  init-01   → hostname-configured
//  init-02   → paquetes base instalados
//  prep-01   → dependencias base instaladas
//  dns-*     → service-active(bind9) + dns-resolution
//  ldap-*    → service-active(slapd) + ldap-bind
//  smb-01    → servicios Samba activos
//  smb-02    → rutas de shares esperadas existen
//  vpn-01    → paquetes WireGuard + wg0.conf + claves servidor
//  vpn-02    → sysctl net.ipv4.ip_forward = 1
//  vpn-03    → claves peer esperadas existen
//  docker-*  → docker-operational
//  agora-01  → directorios persistentes existen
//  agora-02  → .env + compose + config base existen
//  agora-03  → gateway-health (HTTP /healthz)
//  nginx-*   → nginx-config + service-active(nginx)
//  cockpit-* → cockpit.socket activo
//  backup-*  → backup-test
function deriveExpectedVerification(stepId: string, config?: InstallerConfig) {
  if (stepId === "init-01") {
    return [
      {
        kind: "hostname-configured" as const,
        hostname:
          config?.network?.internalDomain?.split(".")[0] ?? config?.company.name.toLowerCase(),
        expectedValue: config?.network?.internalDomain ?? undefined,
        description: "Hostname and /etc/hosts reflect the expected host identity.",
      },
    ];
  }
  if (stepId === "init-02") {
    return [
      {
        kind: "package-installed" as const,
        package: "curl",
        description: "curl is installed as a base utility.",
      },
      {
        kind: "package-installed" as const,
        package: "ufw",
        description: "ufw is installed for firewall management.",
      },
    ];
  }
  if (stepId === "prep-01") {
    return [
      {
        kind: "package-installed" as const,
        package: "gnupg2",
        description: "gnupg2 is installed as a base dependency.",
      },
      {
        kind: "package-installed" as const,
        package: "ca-certificates",
        description: "ca-certificates is installed as a base dependency.",
      },
    ];
  }
  if (stepId.startsWith("dns-")) {
    return [
      { kind: "service-active" as const, service: "bind9", description: "DNS service is active." },
      {
        kind: "dns-resolution" as const,
        hostname: config?.network?.internalDomain ?? "localhost",
        description: "The local DNS resolver responds.",
      },
    ];
  }
  if (stepId.startsWith("ldap-")) {
    return [
      { kind: "service-active" as const, service: "slapd", description: "LDAP service is active." },
      { kind: "ldap-bind" as const, description: "LDAP responds to a base search." },
    ];
  }
  if (stepId === "smb-01" || stepId.startsWith("samba-")) {
    return [
      { kind: "service-active" as const, service: "smbd", description: "Samba service is active." },
      {
        kind: "service-active" as const,
        service: "nmbd",
        description: "NetBIOS service is active.",
      },
    ];
  }
  if (stepId === "smb-02") {
    const rolePaths =
      config?.access.roles.map((role) => `/srv/samba/${normalizeRoleSlug(role.name)}`) ?? [];
    return [
      ...rolePaths.map((sharePath) => ({
        kind: "path-exists" as const,
        path: sharePath,
        description: `Expected Samba directory exists: ${sharePath}.`,
      })),
      {
        kind: "path-exists" as const,
        path: "/srv/samba/compartido",
        description: "Shared Samba directory exists.",
      },
    ];
  }
  if (stepId === "vpn-01" || stepId.startsWith("wireguard-")) {
    return [
      {
        kind: "package-installed" as const,
        package: "wireguard",
        description: "WireGuard package is installed.",
      },
      {
        kind: "path-exists" as const,
        path: "/etc/wireguard/wg0.conf",
        description: "WireGuard base configuration exists.",
      },
      {
        kind: "path-exists" as const,
        path: "/etc/wireguard/server_private.key",
        description: "WireGuard server private key exists.",
      },
    ];
  }
  if (stepId === "vpn-02") {
    return [
      {
        kind: "sysctl-value" as const,
        sysctlKey: "net.ipv4.ip_forward",
        expectedValue: "1",
        description: "IP forwarding is enabled for WireGuard routing.",
      },
    ];
  }
  if (stepId === "vpn-03") {
    const remoteUsers = config?.users?.filter((user) => user.remote) ?? [];
    return remoteUsers.map((user) => ({
      kind: "path-exists" as const,
      path: `/etc/wireguard/peer_${user.username}_private.key`,
      description: `WireGuard key exists for remote user ${user.username}.`,
    }));
  }
  if (stepId.startsWith("docker-")) {
    return [
      {
        kind: "docker-operational" as const,
        service: "docker",
        description: "Docker daemon is operational.",
      },
    ];
  }
  if (stepId === "agora-01") {
    return [
      {
        kind: "path-exists" as const,
        path: "/srv/laia-agora/config",
        description: "Agora config directory exists.",
      },
      {
        kind: "path-exists" as const,
        path: "/srv/laia-agora/workspace",
        description: "Agora workspace directory exists.",
      },
      {
        kind: "path-exists" as const,
        path: "/srv/laia-agora/templates/laia-agora",
        description: "Agora template directory exists.",
      },
    ];
  }
  if (stepId === "agora-02") {
    return [
      {
        kind: "path-exists" as const,
        path: "/opt/laia-agora/.env",
        description: "Agora environment file exists.",
      },
      {
        kind: "path-exists" as const,
        path: "/opt/laia-agora/docker-compose.yml",
        description: "Agora Docker Compose file exists.",
      },
      {
        kind: "path-exists" as const,
        path: "/srv/laia-agora/config/openclaw.json",
        description: "Agora base config exists.",
      },
    ];
  }
  if (stepId.startsWith("nginx-")) {
    return [
      { kind: "nginx-config" as const, description: "Nginx configuration validates cleanly." },
      { kind: "service-active" as const, service: "nginx", description: "Nginx is active." },
    ];
  }
  if (stepId.startsWith("cockpit-")) {
    return [
      {
        kind: "service-active" as const,
        service: "cockpit.socket",
        description: "Cockpit socket is active.",
      },
    ];
  }
  if (stepId.startsWith("backup-")) {
    return [{ kind: "backup-test" as const, description: "Backup script runs successfully." }];
  }
  if (stepId === "agora-03") {
    return [
      {
        kind: "gateway-health" as const,
        url: "http://127.0.0.1:18789/healthz",
        description: "Agora gateway health endpoint responds.",
      },
    ];
  }
  return [];
}

export function buildActionProposalsFromPlan(
  plan: InstallPlan,
  config?: InstallerConfig,
): ActionProposal[] {
  return plan.steps.map((step, index) => ({
    id: `proposal-${index + 1}-${step.id}`,
    title: step.description,
    description: step.description,
    sourceStepId: step.id,
    phase: step.phase,
    commands: step.commands,
    requiresApproval: step.requiresApproval,
    rollback: step.rollback,
    timeout: step.timeout,
    maxRetries: step.maxRetries,
    verification: deriveExpectedVerification(step.id, config),
    changedFiles: deriveChangedFiles(step.commands),
    servicesTouched: deriveServicesTouched(step.id),
  }));
}

export function buildActionProposalsFromIntent(
  intent: ConversationIntent,
  scan?: SystemScan,
): ActionProposal[] {
  const adaptivePlan = buildAdaptiveExecutionPlanFromIntent(intent, scan);
  return buildActionProposalsFromPlan(adaptivePlan, intent.installerConfig);
}

export function createInstallSessionState(params: {
  planSignature: string;
  config: InstallerConfig;
  goal: ConversationIntent["goal"];
  fallbackPlan: InstallPlan;
  intent?: ConversationIntent;
  proposals?: ActionProposal[];
  snapshot: InstallSessionState["snapshot"];
}): InstallSessionState {
  const now = new Date().toISOString();
  return {
    version: 1,
    planSignature: params.planSignature,
    goal: params.goal,
    config: params.config,
    fallbackPlan: params.fallbackPlan,
    updatedAt: now,
    intent: params.intent,
    snapshot: params.snapshot,
    proposals: params.proposals ?? [],
    approvals: {},
    executions: {},
    repairs: {},
    completedProposalIds: [],
  };
}
