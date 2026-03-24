// tools/index.ts — Definiciones y handlers de herramientas para el modo tool-driven
// Las herramientas son expuestas a la IA a través de la API de Anthropic (tool use).

import { generateAndStorePassword } from "./credential-tools.js";
import { addUserToGroup, createLdapGroup, createLdapUser, verifyLdapUser } from "./ldap-tools.js";
import {
  addDnsRecord,
  configureHostname,
  configureWireguardPeer,
} from "./network-tools.js";
import { createSambaShare, registerSambaUser, verifySambaShare } from "./samba-tools.js";
import { configureUfw, enableService, installPackage } from "./service-tools.js";
import {
  checkPortAvailable,
  checkServiceStatus,
  getSystemInfo,
  readFile,
} from "./system-tools.js";
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

export const TOOL_DEFINITIONS: ToolDefinition[] = [
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
    description: "Crea un usuario en OpenLDAP con su rol (creativos, cuentas o comerciales).",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string", description: "Usuario en formato nombre.apellido" },
        givenName: { type: "string", description: "Nombre propio" },
        sn: { type: "string", description: "Apellido" },
        role: {
          type: "string",
          description: "Rol: creativos, cuentas o comerciales",
        },
        uidNumber: { type: "integer", description: "UID único del usuario (ej: 2101)" },
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
    description: "Crea un grupo posixGroup en OpenLDAP.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre del grupo (ej: creativos)" },
        gidNumber: { type: "integer", description: "GID del grupo (ej: 2001)" },
        domain: { type: "string", description: "Dominio interno (ej: miagencia.local)" },
      },
      required: ["name", "gidNumber", "domain"],
    },
  },
  {
    name: "add_user_to_group",
    description: "Añade un usuario como memberUid a un grupo LDAP existente.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string", description: "Usuario en formato nombre.apellido" },
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
        username: { type: "string", description: "Usuario en formato nombre.apellido" },
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
        username: { type: "string", description: "Usuario en formato nombre.apellido" },
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
    description:
      "Establece el hostname del servidor y añade la entrada FQDN en /etc/hosts.",
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
    description:
      "Genera claves WireGuard para un usuario remoto y añade su peer al servidor.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string", description: "Usuario en formato nombre.apellido" },
        clientIp: {
          type: "string",
          description: "IP asignada al cliente en la VPN (ej: 10.10.10.2)",
        },
        serverIp: {
          type: "string",
          description: "IP pública o hostname del servidor WireGuard",
        },
        serverPort: { type: "integer", description: "Puerto UDP del servidor WireGuard (ej: 51820)" },
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
        hostname: { type: "string", description: "Hostname a resolver (ej: server.miagencia.local)" },
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
];

// ── Handlers ──────────────────────────────────────────────────────────────

export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  get_system_info: async () => getSystemInfo(),

  check_port_available: async (input) => checkPortAvailable(input.port as number),

  check_service_status: async (input) => checkServiceStatus(input.service as string),

  read_file: async (input) => readFile(input.path as string),

  install_package: async (input) => installPackage(input.packages as string[]),

  enable_service: async (input) => enableService(input.service as string),

  configure_ufw: async (input) =>
    configureUfw(
      input.port as number,
      input.protocol as "tcp" | "udp",
      input.action as "allow" | "deny",
    ),

  create_ldap_user: async (input) =>
    createLdapUser({
      username: input.username as string,
      givenName: input.givenName as string,
      sn: input.sn as string,
      role: input.role as "creativos" | "cuentas" | "comerciales",
      uidNumber: input.uidNumber as number,
      passwordId: input.passwordId as string,
      domain: input.domain as string,
    }),

  create_ldap_group: async (input) =>
    createLdapGroup(input.name as string, input.gidNumber as number, input.domain as string),

  add_user_to_group: async (input) =>
    addUserToGroup(input.username as string, input.group as string, input.domain as string),

  verify_ldap_user: async (input) =>
    verifyLdapUser(input.username as string, input.domain as string),

  create_samba_share: async (input) =>
    createSambaShare({
      name: input.name as string,
      path: (input.path as string) ?? `/srv/samba/${input.name as string}`,
      validUsers: input.validUsers as string | undefined,
      readOnly: input.readOnly as boolean,
      browseable: input.browseable as boolean,
    }),

  register_samba_user: async (input) =>
    registerSambaUser(input.username as string, input.passwordId as string),

  verify_samba_share: async (input) => verifySambaShare(input.share as string),

  configure_hostname: async (input) =>
    configureHostname(input.hostname as string, input.domain as string),

  configure_wireguard_peer: async (input) =>
    configureWireguardPeer({
      username: input.username as string,
      clientIp: input.clientIp as string,
      serverIp: input.serverIp as string,
      serverPort: input.serverPort as number,
      serverPublicKey: input.serverPublicKey as string,
    }),

  add_dns_record: async (input) =>
    addDnsRecord(input.name as string, input.ip as string, input.domain as string),

  generate_and_store_password: async (input) =>
    generateAndStorePassword({
      id: input.id as string,
      complexity: input.complexity as "medium" | "high",
      description: input.description as string,
    }),

  verify_dns_resolution: async (input) => verifyDnsResolution(input.hostname as string),

  verify_service_chain: async () => verifyServiceChain(),

  run_backup_test: async () => runBackupTest(),
};
