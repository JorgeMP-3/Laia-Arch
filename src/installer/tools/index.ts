// tools/index.ts — Definiciones y handlers de herramientas para el modo tool-driven
// Las herramientas son expuestas a la IA a través de la API de Anthropic (tool use).

import type { ToolResultEnvelope } from "../types.js";
import { generateAndStorePassword } from "./credential-tools.js";
import { addUserToGroup, createLdapGroup, createLdapUser, verifyLdapUser } from "./ldap-tools.js";
import { addDnsRecord, configureHostname, configureWireguardPeer } from "./network-tools.js";
import { createSambaShare, registerSambaUser, verifySambaShare } from "./samba-tools.js";
import {
  addAptRepository,
  configureUfw,
  configureSysctl,
  enableService,
  installPackage,
  readLogs,
  repairDpkg,
  restartService,
  runCommand,
  runDiagnostic,
} from "./service-tools.js";
import {
  checkInternet,
  checkPortAvailable,
  checkServiceStatus,
  getSystemInfo,
  readFile,
  writeFile,
} from "./system-tools.js";
import { INSTALLER_USERNAME_DESCRIPTION } from "./username-policy.js";
import { runBackupTest, verifyDnsResolution, verifyServiceChain } from "./verify-tools.js";

// ── Formato de definición de herramienta (Anthropic API) ──────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ── Definiciones ──────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS_ANTHROPIC: ToolDefinition[] = [
  {
    name: "get_system_info",
    description:
      "Obtiene el último escaneo del sistema: hardware, OS, red, servicios y advertencias.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "check_port_available",
    description: "Comprueba si un puerto TCP/UDP está libre en el servidor.",
    input_schema: {
      type: "object",
      properties: {
        port: { type: "integer", description: "Número de puerto (1-65535)" },
      },
      required: ["port"],
    },
  },
  {
    name: "check_service_status",
    description: "Consulta el estado de un servicio systemd: active, inactive o not-installed.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Nombre del servicio systemd (ej: bind9, slapd)" },
      },
      required: ["service"],
    },
  },
  {
    name: "read_file",
    description:
      "Lee un archivo de configuración del servidor. Solo permite rutas bajo /etc/ o /srv/.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ruta absoluta del archivo a leer" },
      },
      required: ["path"],
    },
  },
  {
    name: "install_package",
    description:
      "Instala uno o más paquetes Debian con apt-get. Requiere aprobación del administrador.",
    input_schema: {
      type: "object",
      properties: {
        packages: {
          type: "array",
          items: { type: "string" },
          description: "Lista de paquetes a instalar",
        },
      },
      required: ["packages"],
    },
  },
  {
    name: "enable_service",
    description: "Activa y arranca un servicio systemd (systemctl enable + start).",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Nombre del servicio systemd" },
      },
      required: ["service"],
    },
  },
  {
    name: "configure_ufw",
    description: "Añade o elimina una regla en el firewall ufw para un puerto y protocolo.",
    input_schema: {
      type: "object",
      properties: {
        port: { type: "integer", description: "Puerto (1-65535)" },
        protocol: { type: "string", description: "Protocolo: tcp o udp" },
        action: { type: "string", description: "Acción: allow o deny" },
      },
      required: ["port", "protocol", "action"],
    },
  },
  {
    name: "create_ldap_user",
    description: "Crea un usuario en OpenLDAP y lo asocia a un rol o departamento.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string", description: INSTALLER_USERNAME_DESCRIPTION },
        givenName: { type: "string", description: "Nombre propio" },
        sn: { type: "string", description: "Apellido" },
        role: {
          type: "string",
          description: "Rol o departamento del usuario (ej: ventas, soporte, administracion)",
        },
        uidNumber: { type: "integer", description: "UID único del usuario (ej: 2101)" },
        gidNumber: {
          type: "integer",
          description: "GID del grupo LDAP. Si se omite, se deriva automáticamente del rol.",
        },
        passwordId: {
          type: "string",
          description: "ID de credencial almacenada para la contraseña del usuario",
        },
        domain: {
          type: "string",
          description: "Dominio interno (ej: miagencia.local)",
        },
      },
      required: ["username", "givenName", "sn", "role", "uidNumber", "passwordId", "domain"],
    },
  },
  {
    name: "create_ldap_group",
    description: "Crea un grupo posixGroup en OpenLDAP para un rol o departamento.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre del grupo (ej: ventas)" },
        gidNumber: {
          type: "integer",
          description: "GID del grupo. Si se omite, se calcula de forma estable.",
        },
        domain: { type: "string", description: "Dominio interno (ej: miagencia.local)" },
      },
      required: ["name", "domain"],
    },
  },
  {
    name: "add_user_to_group",
    description: "Añade un usuario como memberUid a un grupo LDAP existente.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string", description: INSTALLER_USERNAME_DESCRIPTION },
        group: { type: "string", description: "Nombre del grupo LDAP" },
        domain: { type: "string", description: "Dominio interno" },
      },
      required: ["username", "group", "domain"],
    },
  },
  {
    name: "verify_ldap_user",
    description: "Comprueba si un usuario existe en LDAP y devuelve sus grupos.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string", description: INSTALLER_USERNAME_DESCRIPTION },
        domain: { type: "string", description: "Dominio interno" },
      },
      required: ["username", "domain"],
    },
  },
  {
    name: "create_samba_share",
    description: "Crea una carpeta compartida en Samba y la registra en smb.conf.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre del share (ej: creativos)" },
        path: {
          type: "string",
          description: "Ruta de la carpeta — debe ser /srv/samba/NAME",
        },
        validUsers: {
          type: "string",
          description: "Usuarios o grupos con acceso, ej: @creativos",
        },
        readOnly: { type: "boolean", description: "Solo lectura" },
        browseable: { type: "boolean", description: "Visible en la red" },
      },
      required: ["name", "readOnly", "browseable"],
    },
  },
  {
    name: "register_samba_user",
    description: "Registra un usuario en la base de datos de contraseñas de Samba (smbpasswd).",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string", description: INSTALLER_USERNAME_DESCRIPTION },
        passwordId: {
          type: "string",
          description: "ID de credencial almacenada con la contraseña Samba",
        },
      },
      required: ["username", "passwordId"],
    },
  },
  {
    name: "verify_samba_share",
    description: "Verifica que un share de Samba es accesible localmente.",
    input_schema: {
      type: "object",
      properties: {
        share: { type: "string", description: "Nombre del share a verificar" },
      },
      required: ["share"],
    },
  },
  {
    name: "configure_hostname",
    description: "Establece el hostname del servidor y añade la entrada FQDN en /etc/hosts.",
    input_schema: {
      type: "object",
      properties: {
        hostname: { type: "string", description: "Nombre corto del host (ej: laia-server)" },
        domain: { type: "string", description: "Dominio interno (ej: miagencia.local)" },
      },
      required: ["hostname", "domain"],
    },
  },
  {
    name: "configure_wireguard_peer",
    description: "Genera claves WireGuard para un usuario remoto y añade su peer al servidor.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string", description: INSTALLER_USERNAME_DESCRIPTION },
        clientIp: {
          type: "string",
          description: "IP asignada al cliente en la VPN (ej: 10.10.10.2)",
        },
        serverIp: {
          type: "string",
          description: "IP pública o hostname del servidor WireGuard",
        },
        serverPort: {
          type: "integer",
          description: "Puerto UDP del servidor WireGuard (ej: 51820)",
        },
        serverPublicKey: { type: "string", description: "Clave pública del servidor WireGuard" },
      },
      required: ["username", "clientIp", "serverIp", "serverPort", "serverPublicKey"],
    },
  },
  {
    name: "add_dns_record",
    description: "Añade un registro A al archivo de zona BIND9 y recarga el servidor DNS.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Nombre del host a resolver (ej: fileserver)",
        },
        ip: { type: "string", description: "Dirección IP del registro A" },
        domain: { type: "string", description: "Dominio de la zona (ej: miagencia.local)" },
      },
      required: ["name", "ip", "domain"],
    },
  },
  {
    name: "generate_and_store_password",
    description:
      "Genera una contraseña segura y la almacena cifrada. Devuelve el ID de la credencial.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Identificador único de la credencial (ej: laia-arch-ldap-admin)",
        },
        complexity: { type: "string", description: "Complejidad: medium o high" },
        description: { type: "string", description: "Descripción legible de la credencial" },
      },
      required: ["id", "complexity", "description"],
    },
  },
  {
    name: "verify_dns_resolution",
    description: "Comprueba si un hostname se resuelve correctamente a través del DNS local.",
    input_schema: {
      type: "object",
      properties: {
        hostname: {
          type: "string",
          description: "Hostname a resolver (ej: server.miagencia.local)",
        },
      },
      required: ["hostname"],
    },
  },
  {
    name: "verify_service_chain",
    description:
      "Verifica el estado de todos los servicios LAIA: DNS, LDAP, Samba, Docker, Nginx, WireGuard.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "run_backup_test",
    description: "Ejecuta el script de backup y devuelve el tamaño del directorio de backups.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "check_internet",
    description: "Verifica si el servidor tiene conectividad a internet y mide la latencia.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "write_file",
    description:
      "Escribe o sobreescribe un archivo de configuración en el servidor. Solo permite rutas en /etc/, /srv/ y /home/laia-arch/.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Ruta absoluta del archivo (debe comenzar por /etc/, /srv/ o /home/laia-arch/)",
        },
        content: { type: "string", description: "Contenido a escribir en el archivo" },
        append: {
          type: "boolean",
          description: "Si true, añade al final en lugar de sobreescribir",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "configure_sysctl",
    description:
      "Aplica un parámetro del kernel via sysctl y lo hace persistente en /etc/sysctl.conf.",
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Clave del parámetro (ej: net.ipv4.ip_forward)",
        },
        value: { type: "string", description: "Valor a aplicar (ej: 1)" },
        persistent: {
          type: "boolean",
          description: "Si true, escribe la línea en /etc/sysctl.conf",
        },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "add_apt_repository",
    description:
      "Añade un repositorio externo apt con su clave GPG. Necesario antes de instalar Docker u otros paquetes externos.",
    input_schema: {
      type: "object",
      properties: {
        repoUrl: {
          type: "string",
          description: "URL base del repositorio (ej: https://download.docker.com/linux/ubuntu)",
        },
        gpgKeyUrl: {
          type: "string",
          description: "URL de la clave GPG del repositorio",
        },
        listFileName: {
          type: "string",
          description: "Nombre del archivo en sources.list.d (ej: docker.list)",
        },
        distribution: {
          type: "string",
          description: "Nombre de la distribución Ubuntu (ej: jammy)",
        },
      },
      required: ["repoUrl", "gpgKeyUrl", "listFileName"],
    },
  },
  {
    name: "run_diagnostic",
    description:
      "Ejecuta un comando de solo lectura para diagnóstico, sin sudo y sin aprobación. Úsalo para: named-checkconf, named-checkzone, dpkg -l, grep en /etc/, cat, ls, ss, ip, df, etc. NO uses esta tool para comandos que modifican el sistema.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Comando de diagnóstico de solo lectura a ejecutar",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "run_command",
    description:
      "Ejecuta un comando de sistema con sudo. Úsalo SOLO para comandos que modifican el sistema (editar archivos, configurar servicios, etc.) cuando las otras tools no sean suficientes. SIEMPRE requiere aprobación del administrador. Para diagnóstico, usa run_diagnostic.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Comando a ejecutar (se ejecuta con: sudo bash -c '...')",
        },
        reason: {
          type: "string",
          description: "Por qué es necesario ejecutar este comando concreto",
        },
      },
      required: ["command", "reason"],
    },
  },
  {
    name: "repair_dpkg",
    description:
      "Repara dpkg cuando queda en estado inconsistente tras un fallo de apt. Ejecuta: dpkg --configure -a → apt-get -f install → apt-get autoremove. Requiere aprobación del administrador.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "restart_service",
    description:
      "Reinicia un servicio systemd (systemctl restart). Útil para forzar recarga de configuración tras un fallo. Requiere aprobación del administrador.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Nombre del servicio systemd (ej: bind9, slapd)" },
      },
      required: ["service"],
    },
  },
  {
    name: "read_logs",
    description:
      "Lee las últimas líneas del log de un servicio systemd con journalctl. Solo lectura, no requiere aprobación.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Nombre del servicio systemd (ej: bind9, slapd)" },
        lines: {
          type: "integer",
          description: "Número de líneas a leer (1-300, por defecto 60)",
        },
      },
      required: ["service"],
    },
  },
];

// ── Formato OpenAI (para OpenAI, OpenRouter, openai-compatible) ──────────

export interface ToolDefinitionOpenAI {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export const TOOL_DEFINITIONS_OPENAI: ToolDefinitionOpenAI[] = TOOL_DEFINITIONS_ANTHROPIC.map(
  (t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }),
);

// ── Handlers ──────────────────────────────────────────────────────────────

export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

function extractObservedState(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return {};
  }

  const record = { ...(result as Record<string, unknown>) };
  delete record["success"];
  delete record["retryable"];
  delete record["error"];
  return record;
}

function inferChangedFiles(name: string, input: Record<string, unknown>): string[] {
  switch (name) {
    case "write_file":
      return typeof input.path === "string" ? [input.path] : [];
    case "add_dns_record":
      return typeof input.domain === "string" ? [`/etc/bind/db.${input.domain}`] : [];
    case "configure_hostname":
      return ["/etc/hostname", "/etc/hosts"];
    case "configure_wireguard_peer":
      return ["/etc/wireguard/wg0.conf"];
    case "create_samba_share":
      return ["/etc/samba/smb.conf"];
    case "configure_sysctl":
      return input.persistent ? ["/etc/sysctl.conf"] : [];
    case "add_apt_repository":
      return typeof input.listFileName === "string"
        ? [`/etc/apt/sources.list.d/${input.listFileName}`]
        : [];
    default:
      return [];
  }
}

function inferServicesTouched(name: string, input: Record<string, unknown>): string[] {
  switch (name) {
    case "check_service_status":
    case "enable_service":
      return typeof input.service === "string" ? [input.service] : [];
    case "configure_ufw":
      return ["ufw"];
    case "create_ldap_user":
    case "create_ldap_group":
    case "add_user_to_group":
    case "verify_ldap_user":
      return ["slapd"];
    case "create_samba_share":
    case "register_samba_user":
    case "verify_samba_share":
      return ["smbd", "nmbd"];
    case "add_dns_record":
    case "verify_dns_resolution":
      return ["bind9"];
    case "configure_wireguard_peer":
      return ["wg-quick@wg0"];
    case "verify_service_chain":
      return ["bind9", "slapd", "smbd", "docker", "nginx", "wg-quick@wg0", "cockpit"];
    case "run_backup_test":
      return ["cron"];
    case "install_package":
      return Array.isArray(input.packages) ? ["apt"] : [];
    default:
      return [];
  }
}

function normalizeToolResult(
  name: string,
  input: Record<string, unknown>,
  result: unknown,
): ToolResultEnvelope {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return {
      success: false,
      retryable: true,
      observed_state: {},
      changed_files: inferChangedFiles(name, input),
      services_touched: inferServicesTouched(name, input),
      error: "resultado de herramienta inválido",
      output: result,
    };
  }

  const record = result as Record<string, unknown>;
  return {
    success: record["success"] === true,
    retryable: record["retryable"] === true,
    observed_state: extractObservedState(record),
    changed_files: inferChangedFiles(name, input),
    services_touched: inferServicesTouched(name, input),
    rollback_hint:
      typeof record["rollback_hint"] === "string" ? record["rollback_hint"] : undefined,
    error: typeof record["error"] === "string" ? record["error"] : undefined,
    output: record,
  };
}

function wrapToolHandler(
  name: string,
  handler: (input: Record<string, unknown>) => Promise<unknown>,
): ToolHandler {
  return async (input) => normalizeToolResult(name, input, await handler(input));
}

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  get_system_info: wrapToolHandler("get_system_info", async () => getSystemInfo()),
  check_port_available: wrapToolHandler("check_port_available", async (input) =>
    checkPortAvailable(input.port as number),
  ),
  check_service_status: wrapToolHandler("check_service_status", async (input) =>
    checkServiceStatus(input.service as string),
  ),
  read_file: wrapToolHandler("read_file", async (input) => readFile(input.path as string)),
  install_package: wrapToolHandler("install_package", async (input) =>
    installPackage(input.packages as string[]),
  ),
  enable_service: wrapToolHandler("enable_service", async (input) =>
    enableService(input.service as string),
  ),
  configure_ufw: wrapToolHandler("configure_ufw", async (input) =>
    configureUfw(
      input.port as number,
      input.protocol as "tcp" | "udp",
      input.action as "allow" | "deny",
    ),
  ),
  create_ldap_user: wrapToolHandler("create_ldap_user", async (input) =>
    createLdapUser({
      username: input.username as string,
      givenName: input.givenName as string,
      sn: input.sn as string,
      role: input.role as string,
      uidNumber: input.uidNumber as number,
      gidNumber: input.gidNumber as number | undefined,
      passwordId: input.passwordId as string,
      domain: input.domain as string,
    }),
  ),
  create_ldap_group: wrapToolHandler("create_ldap_group", async (input) =>
    createLdapGroup(
      input.name as string,
      input.gidNumber as number | undefined,
      input.domain as string,
    ),
  ),
  add_user_to_group: wrapToolHandler("add_user_to_group", async (input) =>
    addUserToGroup(input.username as string, input.group as string, input.domain as string),
  ),
  verify_ldap_user: wrapToolHandler("verify_ldap_user", async (input) =>
    verifyLdapUser(input.username as string, input.domain as string),
  ),
  create_samba_share: wrapToolHandler("create_samba_share", async (input) =>
    createSambaShare({
      name: input.name as string,
      path: (input.path as string) ?? `/srv/samba/${input.name as string}`,
      validUsers: input.validUsers as string | undefined,
      readOnly: input.readOnly as boolean,
      browseable: input.browseable as boolean,
    }),
  ),
  register_samba_user: wrapToolHandler("register_samba_user", async (input) =>
    registerSambaUser(input.username as string, input.passwordId as string),
  ),
  verify_samba_share: wrapToolHandler("verify_samba_share", async (input) =>
    verifySambaShare(input.share as string),
  ),
  configure_hostname: wrapToolHandler("configure_hostname", async (input) =>
    configureHostname(input.hostname as string, input.domain as string),
  ),
  configure_wireguard_peer: wrapToolHandler("configure_wireguard_peer", async (input) =>
    configureWireguardPeer({
      username: input.username as string,
      clientIp: input.clientIp as string,
      serverIp: input.serverIp as string,
      serverPort: input.serverPort as number,
      serverPublicKey: input.serverPublicKey as string,
    }),
  ),
  add_dns_record: wrapToolHandler("add_dns_record", async (input) =>
    addDnsRecord(input.name as string, input.ip as string, input.domain as string),
  ),
  generate_and_store_password: wrapToolHandler("generate_and_store_password", async (input) =>
    generateAndStorePassword({
      id: input.id as string,
      complexity: input.complexity as "medium" | "high",
      description: input.description as string,
    }),
  ),
  verify_dns_resolution: wrapToolHandler("verify_dns_resolution", async (input) =>
    verifyDnsResolution(input.hostname as string),
  ),
  verify_service_chain: wrapToolHandler("verify_service_chain", async () => verifyServiceChain()),
  run_backup_test: wrapToolHandler("run_backup_test", async () => runBackupTest()),
  check_internet: wrapToolHandler("check_internet", async () => checkInternet()),
  write_file: wrapToolHandler("write_file", async (input) =>
    writeFile({
      path: input.path as string,
      content: input.content as string,
      append: input.append as boolean | undefined,
    }),
  ),
  configure_sysctl: wrapToolHandler("configure_sysctl", async (input) =>
    configureSysctl({
      key: input.key as string,
      value: input.value as string,
      persistent: input.persistent as boolean | undefined,
    }),
  ),
  add_apt_repository: wrapToolHandler("add_apt_repository", async (input) =>
    addAptRepository({
      repoUrl: input.repoUrl as string,
      gpgKeyUrl: input.gpgKeyUrl as string,
      listFileName: input.listFileName as string,
      distribution: input.distribution as string | undefined,
    }),
  ),
  run_diagnostic: wrapToolHandler("run_diagnostic", async (input) =>
    runDiagnostic(input.command as string),
  ),
  run_command: wrapToolHandler("run_command", async (input) => runCommand(input.command as string)),
  repair_dpkg: wrapToolHandler("repair_dpkg", async () => repairDpkg()),
  restart_service: wrapToolHandler("restart_service", async (input) =>
    restartService(input.service as string),
  ),
  read_logs: wrapToolHandler("read_logs", async (input) =>
    readLogs(input.service as string, input.lines as number | undefined),
  ),
};
