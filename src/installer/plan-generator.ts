// plan-generator.ts — Generación determinista del plan de instalación
// El plan se genera por código, no por la IA. La IA solo recopila la config.

import type { InstallerConfig, InstallPlan, InstallStep } from "./types.js";

export type PlanStatus = "draft" | "approved" | "executing";

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
    steps.push({
      id: "dns-01",
      phase: 2,
      description: "Instalar BIND9 como servidor DNS interno",
      commands: [
        "apt-get install -y bind9 bind9utils bind9-doc",
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
    const domain = config.company.name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

    steps.push({
      id: "ldap-01",
      phase: 3,
      description: "Instalar OpenLDAP (slapd) para gestión de usuarios en red",
      commands: [
        "apt-get install -y slapd ldap-utils",
        "systemctl enable slapd",
        "systemctl start slapd",
      ],
      requiresApproval: true,
      rollback: "apt-get remove -y --purge slapd ldap-utils && rm -rf /etc/ldap /var/lib/ldap",
    });

    steps.push({
      id: "ldap-02",
      phase: 3,
      description: `Crear estructura de directorio LDAP para ${domain}.local`,
      commands: [
        `mkdir -p /tmp/laia-arch-ldap`,
        // Generar LDIF base con la estructura de la empresa
        `printf 'dn: ou=users,dc=${domain},dc=local\\nobjectClass: organizationalUnit\\nou: users\\n\\ndn: ou=groups,dc=${domain},dc=local\\nobjectClass: organizationalUnit\\nou: groups\\n' > /tmp/laia-arch-ldap/base.ldif`,
      ],
      requiresApproval: true,
    });
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
      description: "Crear directorio compartido base y ajustar permisos",
      commands: [
        "mkdir -p /srv/samba/compartido",
        "chown -R root:sambashare /srv/samba/compartido",
        "chmod 2770 /srv/samba/compartido",
      ],
      requiresApproval: true,
    });
    estimatedMinutes += 10;
  }

  // ── Fase 5: VPN (WireGuard) ──────────────────────────────────────────────
  if (config.services.wireguard) {
    steps.push({
      id: "vpn-01",
      phase: 5,
      description: "Instalar WireGuard VPN para acceso remoto seguro",
      commands: [
        "apt-get install -y wireguard wireguard-tools",
        "wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key",
        "chmod 600 /etc/wireguard/server_private.key",
      ],
      requiresApproval: true,
      rollback:
        "apt-get remove -y --purge wireguard wireguard-tools && rm -f /etc/wireguard/server_*.key",
    });

    steps.push({
      id: "vpn-02",
      phase: 5,
      description: "Habilitar reenvío de paquetes IP (necesario para WireGuard)",
      commands: ["echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf", "sysctl -p /etc/sysctl.conf"],
      requiresApproval: true,
    });
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
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                   PLAN DE INSTALACIÓN                  ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`  Pasos totales   : ${plan.steps.length}`);
  console.log(`  Tiempo estimado : ~${plan.estimatedMinutes} minutos\n`);

  let currentPhase = -1;
  for (const step of plan.steps) {
    if (step.phase !== currentPhase) {
      currentPhase = step.phase;
      console.log(`\n  ── Fase ${step.phase} ──`);
    }
    const approval = step.requiresApproval ? " [requiere aprobación]" : "";
    console.log(`    ${step.id}  ${step.description}${approval}`);
  }

  if (plan.warnings.length > 0) {
    console.log("\n  ADVERTENCIAS:");
    for (const w of plan.warnings) {
      console.log(`    ⚠  ${w}`);
    }
  }

  if (plan.requiredCredentials.length > 0) {
    console.log("\n  Credenciales que se generarán de forma segura:");
    for (const cred of plan.requiredCredentials) {
      console.log(`    🔑 ${cred}`);
    }
  }

  console.log();
}
