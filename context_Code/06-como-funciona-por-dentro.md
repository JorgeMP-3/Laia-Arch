# Cómo funciona Laia Arch por dentro

> Documento técnico de arquitectura interna.
> Basado en el código real a fecha 2026-03-26.

---

## Visión de conjunto

Laia Arch es un instalador conversacional que toma un servidor Ubuntu vacío y lo deja configurado con los servicios que la empresa necesita. Opera en la terminal sin interfaz gráfica.

El flujo completo tiene 6 fases secuenciales, pero en la Fase 3 ya existen dos caminos internos:

```
Fase 0: Bootstrap (proveedor IA)
Fase 1: Escaneo del sistema
Fase 2: Conversación con la IA  ←─ aquí está la personalización
Fase 3: Preparación de ejecución
Fase 4: Generación de credenciales
Fase 5: Ejecución del plan
```

En `guided` y `tool-driven`, la Fase 3 sigue siendo plan determinista clásico.
En `adaptive`, la Fase 3 ya puede construir proposals directas del agente y dejar el plan solo como fallback seguro.

Cada fase produce un objeto que alimenta la siguiente. El código de entrada es `src/installer/index.ts`.

---

## Mapa de archivos

```
src/installer/
├── index.ts                  Orquestador — encadena las 6 fases
├── types.ts                  Todos los tipos compartidos
├── bootstrap.ts              Fase 0: configura el proveedor IA
├── scanner.ts                Fase 1: inspecciona hardware/OS/red
├── conversation.ts           Fase 2: intercambio turno a turno con la IA
├── conversation-semantics.ts Análisis del contenido de la conversación
├── agentic.ts                Transforma config/plan → estructuras agénticas
├── plan-generator.ts         Fase 3: genera los pasos de instalación por código
├── credential-manager.ts     Fase 4: genera y guarda contraseñas de forma segura
├── executor.ts               Fase 5: ejecuta, verifica y repara cada paso
├── uninstaller.ts            Revierte la instalación (para testing o rollback)
├── presets/                  Configuraciones guardadas para reutilizar
└── tools/
    ├── index.ts              Registro y despacho de todas las tools
    ├── system-tools.ts       Tools de sistema (apt, systemctl, ficheros...)
    ├── service-tools.ts      Tools de servicios (DNS, LDAP, Samba, WG, Docker)
    └── verify-tools.ts       Tools de verificación activa post-ejecución
```

---

## Fase 0 — Bootstrap (`bootstrap.ts`)

Antes de cualquier conversación, Laia Arch necesita saber con qué IA va a hablar.

El bootstrap lee (o pide al usuario) las credenciales del proveedor y devuelve un `BootstrapResult`:

```typescript
{
  providerId: "anthropic" | "openai" | "deepseek" | "ollama" | "openrouter",
  model: string,
  profileId: string,
  supportsReasoning: boolean   // true si el modelo soporta chain-of-thought
}
```

Este objeto viaja por todo el sistema y lo usa `conversation.ts` para saber cómo llamar a la API.

---

## Fase 1 — Escaneo (`scanner.ts`)

El scanner observa el servidor sin modificar nada. Devuelve un `SystemScan`:

```typescript
{
  hardware: { arch, cores, ramGb, diskFreeGb, diskTotalGb },
  os: { distribution, version, kernel, hostname },
  network: { localIp, subnet, gateway, dns, hasInternet, devices[], interfaces? },
  services: string[],   // servicios systemd activos
  ports: number[],      // puertos en escucha
  software: { node?, docker?, python3?, git? },
  warnings: string[]
}
```

El resultado se guarda en `~/.laia-arch/last-scan.json` y se pasa a la conversación para que la IA sepa en qué servidor está trabajando.

Semántica actual del bloque de red:

- `network.localIp` sigue siendo la interfaz primaria por compatibilidad
- `network.interfaces` puede incluir varias interfaces IPv4 activas observadas
- la detección de dispositivos sigue favoreciendo la ruta principal, pero ya no oculta que el host pueda tener más de una red relevante

---

## Fase 2 — Conversación (`conversation.ts` + `conversation-semantics.ts`)

### Los tres modos de instalación

Los modos tienen dos nombres: el que aparece en la UI y el que usa el código.

| UI (lo que ve el admin) | Código (`InstallMode`) | Descripción                                                                                                  | Cuándo usarlo                                                                                     |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Automático**          | `tool-driven`          | La IA hace ≤5 preguntas y ejecuta con tools predefinidas. Instala LAIA base sin personalización por empresa. | IAs con capacidad limitada o cuando no se necesita adaptación                                     |
| **Asistido**            | `guided`               | 7 etapas fijas. Siempre el mismo camino basado en `install-prompts/`.                                        | Instalaciones estándar predecibles                                                                |
| **Adaptativo**          | `adaptive`             | La IA adapta las preguntas a la empresa. Camino personalizado.                                               | Primera instalación, empresas con necesidades específicas, IAs con capacidad real de razonamiento |

### Estado actual vs objetivo del modo Adaptativo

**Estado actual (cómo funciona hoy):**

1. La IA conversa de forma adaptativa y extrae una `InstallerConfig` estructurada.
2. Se construye un `ConversationIntent` estructurado.
3. En `adaptive`, `agentic.ts` puede generar `ActionProposal` directas desde ese intent.
4. El executor recorre esas proposals directamente.
5. El plan determinista queda como fallback seguro y como artefacto de resumen/reanudación.

La IA ya gobierna el camino adaptativo del instalador sin depender obligatoriamente de `plan-generator.ts`.

**Objetivo (visión del proyecto):**

El agente observa el sistema, decide qué hacer, ejecuta, verifica y repara sobre la marcha.
El plan determinista queda como fallback de seguridad, no como camino principal.

Esta transición ya quedó cerrada en su primer nivel funcional: el siguiente paso es hacer que el razonamiento adaptativo diverja más del catálogo fijo de comandos cuando el host ya tenga piezas reutilizables.

### Qué hace conversation.ts

1. Resuelve el directorio de prompts desde varias rutas candidatas (`import.meta.url`, raíz del paquete, `cwd`, instalaciones locales y override por `LAIA_ARCH_PROMPTS_DIR`)
2. Carga el prompt del sistema desde `install-prompts/` según el modo
3. Envía el SystemScan como contexto inicial
4. Gestiona los turnos de conversación (usuario ↔ IA)
5. Si el modelo soporta reasoning (`supportsReasoning=true`), añade parámetros de chain-of-thought
6. Al final extrae la `InstallerConfig` del último mensaje de la IA (JSON incrustado)

### Qué hace conversation-semantics.ts

Analiza el **contenido** de la conversación para producir artefactos semánticos:

- **Hechos confirmados** (`ConversationFact[]`): lo que el usuario dijo explícitamente
- **Huecos pendientes** (`ConversationGap[]`): datos que faltan o son ambiguos
- **Contradicciones** (`ConversationContradiction[]`): cuando el usuario se contradice (ej. "hay 3 remotos" luego "nadie trabaja remotamente")
- **Decisiones** (`string[]`): frases legibles que explican las elecciones tomadas

Combina heurísticas locales (regex sobre el transcript) con artefactos que la IA pudo haber devuelto directamente.

### El artefacto final: ConversationIntent

Al terminar la conversación se produce un `ConversationIntent`:

```typescript
{
  mode: InstallMode,
  goal: InstallationGoal,           // hostname, dominio, servicios, usuarios
  summary: string,                  // una línea con el estado
  confirmedFacts: ConversationFact[],
  pendingGaps: ConversationGap[],
  contradictions: ConversationContradiction[],
  decisions: string[],
  installerConfig: InstallerConfig, // la config estructurada que va al plan
  conversationMessages: [...],      // transcript completo
  completedAt: string
}
```

---

## Fase 3 — Preparación de ejecución (`plan-generator.ts` + `agentic.ts`)

En esta fase hay dos caminos:

### Camino A — determinista (`guided` y `tool-driven`)

**El plan se genera por código, no por la IA.** La función `generatePlan(config)` lee la `InstallerConfig` y emite una lista ordenada de `InstallStep`.

### Pasos que puede generar

| ID           | Fase | Qué hace                                     |
| ------------ | ---- | -------------------------------------------- |
| `init-01`    | 0    | Configura hostname y /etc/hosts              |
| `init-02`    | 0    | Instala utilidades base (curl, git, ufw...)  |
| `prep-01`    | 1    | apt update + upgrade                         |
| `dns-01`     | 2    | Instala BIND9 y configura zona DNS           |
| `ldap-01`    | 3    | Instala OpenLDAP (slapd)                     |
| `ldap-02`    | 3    | Crea UOs y grupos LDAP (base.ldif)           |
| `ldap-03`    | 3    | Crea usuarios LDAP nominales                 |
| `ldap-04`    | 3    | Añade membresía (memberUid) a grupos         |
| `smb-01`     | 4    | Instala Samba                                |
| `smb-02`     | 4    | Crea carpetas compartidas por rol            |
| `vpn-01`     | 5    | Instala WireGuard, genera claves de servidor |
| `vpn-02`     | 5    | Habilita IP forwarding                       |
| `vpn-03`     | 5    | Genera claves por usuario remoto             |
| `docker-01`  | 6    | Instala Docker Engine oficial                |
| `agora-01`   | 6    | Prepara directorios de Laia Agora            |
| `agora-02`   | 6    | Genera docker-compose.yml de Agora           |
| `agora-03`   | 6    | Levanta Agora y valida /healthz (retry 90s)  |
| `nginx-01`   | 7    | Instala Nginx como proxy inverso             |
| `cockpit-01` | 8    | Instala Cockpit (panel web :9090)            |
| `backup-01`  | 9    | Configura rsync diario con retención         |

Solo se generan los pasos de los servicios habilitados en `config.services`.

### Credenciales LDAP: nunca en claro

Las contraseñas LDAP se recuperan desde el keyring del sistema (no se pasan como argumento CLI). El plan genera bash inline que:

1. Intenta `secret-tool` (Linux GNOME keyring)
2. Si no, intenta `security` (macOS)
3. Si no, lee `~/.laia-arch/credentials/.<id>`
4. Escribe la contraseña en `/tmp/laia-arch-ldap/admin.pwd` (chmod 600)
5. La usa con `ldapadd -y` y borra el fichero al salir (trap EXIT)

---

### Camino B — agentic directo (`adaptive`)

En modo `adaptive`, `src/installer/index.ts` ya no tiene por qué pasar por `plan-generator.ts`.

El camino actual es:

1. `conversation.ts` devuelve `ConversationIntent`
2. `agentic.ts` construye:
   - `buildAdaptiveExecutionPlanFromIntent()`
   - `buildActionProposalsFromIntent()`
3. `index.ts` usa `prepareInstallerExecutionArtifacts()` para elegir ese camino
4. `executor.ts` ejecuta las proposals con `executeActionProposals()`

El plan adaptativo sigue existiendo, pero ya no manda la ejecución. Se usa para:

- mostrar un preview legible al administrador
- calcular credenciales requeridas
- persistencia de sesión
- reanudación segura
- resumen y contexto de rescate

---

## agentic.ts — el puente entre intención y ejecución

`agentic.ts` transforma la conversación y/o el plan en `ActionProposal`, que es la **unidad primaria de trabajo del executor**.

Cada proposal añade:

- **Verificación esperada**: qué checks concretos deben pasar
- **Archivos tocados**: extraídos automáticamente de los comandos (regex sobre rutas `/etc/`, `/srv/`, `/opt/`...)
- **Servicios afectados**: inferidos del prefijo del step id (ej. `ldap-*` → `slapd`)

También construye el `InstallSessionState` inicial con todos los campos vacíos listos para que el executor los vaya rellenando.

Funciones principales:

- `buildConversationIntent()` — extrae intención desde config o desde conversación real
- `buildActionProposalsFromPlan()` — convierte plan en propuestas con verificación declarada
- `buildAdaptiveExecutionPlanFromIntent()` — crea el plan fallback del camino adaptativo sin pasar por `plan-generator.ts`
- `buildActionProposalsFromIntent()` — crea proposals directas desde `ConversationIntent`
- `createInstallSessionState()` — inicializa sesión persistible con snapshot y propuestas

---

## Fase 4 — Credenciales (`credential-manager.ts`)

Antes de ejecutar, el sistema genera automáticamente contraseñas seguras para cada servicio que lo necesite y las almacena en el keyring. **Nunca pasan por el contexto de la IA.**

La longitud depende de la política de seguridad configurada:

- `basic`: 16 caracteres, sin símbolos
- `medium`: 24 caracteres, con símbolos
- `high`: 32 caracteres, con símbolos

---

## Fase 5 — Ejecución (`executor.ts`)

El executor es el módulo más complejo. Su responsabilidad es llevar cada `ActionProposal` a estado `done` con verificación real.

La unidad primaria de trabajo es `ActionProposal`, no `InstallStep`. Todo — approval, execution, repair, completed — se traza por `proposal.id`.

Ahora tiene dos puntos de entrada:

- `executePlan(plan, ...)` -> camino determinista/fallback
- `executeActionProposals(proposals, ...)` -> camino agentic directo de `adaptive`

Ambos convergen en el mismo bucle interno de ejecución, verificación, reparación y reanudación.

### Ciclo de vida de un paso

```
[pending] → aprobación HITL → [running] → ejecución → verificación
                                                           ↓
                                               OK → [done]
                                               FAIL → política de reparación
```

### Política de reparación (4 niveles)

1. **Reintento transitorio** (`transient-retry`, máx. 2): si el error parece temporal (timeout, red caída, apt lock...), reintenta automáticamente
2. **Reintento de verificación** (`verification-retry`): si el comando tuvo exit 0 pero la verificación activa falló, reintenta el ciclo completo antes de escalar
3. **Rescate por IA** (`ai-rescue`): la IA analiza el error completo + contexto del sistema + intent de la conversación y propone comandos alternativos
4. **Escalada manual (HITL)** (`manual-escalation`): si la IA tampoco puede resolverlo, se pausa y el usuario decide qué hacer

El rescate no es un modo separado. Es un `RepairAttempt` con `strategy: "ai-rescue"` dentro del mismo flujo del executor.
Además, ya no trabaja con contexto parcial: el executor construye memoria operativa explícita desde `InstallSessionState` y se la pasa al prompt de rescate.

### Memoria operativa compartida entre instalación y rescate

Cuando se activa `ai-rescue`, el prompt recibe tres bloques estructurados:

- **ConversationIntent original**: qué quería instalar la empresa, qué servicios, qué dominio, qué decisiones, qué huecos y qué contradicciones existían
- **Historial de ejecución de la sesión**: qué pasos se ejecutaron, qué devolvieron y qué verificación pasó o falló
- **Historial de reparaciones de la sesión**: qué estrategias de repair ya se intentaron y con qué resultado

Esto resuelve la separación mental entre “instalación normal” y “modo rescate”.
Los dos caminos ya comparten la misma sesión persistida como memoria operativa.

### Verificación activa

Un paso no se considera completado solo porque su comando devolvió exit 0. El executor lanza verificaciones reales:

| Tipo                 | Qué verifica                                           |
| -------------------- | ------------------------------------------------------ |
| `service-active`     | `systemctl is-active <service>`                        |
| `dns-resolution`     | Resolución DNS del dominio interno                     |
| `ldap-bind`          | `ldapsearch -x -b <dc>`                                |
| `samba-share`        | `smbclient -L localhost`                               |
| `wireguard-active`   | `wg show` muestra la interfaz                          |
| `docker-operational` | `docker info` sin error                                |
| `nginx-config`       | `nginx -t` pasa                                        |
| `backup-test`        | El script rsync se ejecuta sin error                   |
| `gateway-health`     | HTTP GET `http://127.0.0.1:18789/healthz` responde 200 |

Limitación actual: pasos sin `verification` declarada siguen aceptando código 0 como éxito.

### Persistencia del estado y reanudación

Durante la ejecución se mantiene un `InstallSessionState` que se persiste en disco.

Si el proceso se interrumpe, la reanudación ofrece tres caminos:

1. **Reanudar** — continúa desde el último paso completado con contexto operativo completo
2. **Reiniciar desde cero** — limpia el estado pero preserva y restaura credenciales y perfil de bootstrap
3. **Desinstalar y reinstalar** — elimina servicios instalados y reinicia el proceso completo

La preservación de credenciales en el clean restart es crítica: evita que fases como LDAP fallen porque las contraseñas ya no están disponibles.

---

## Las tools (`src/installer/tools/`)

Las tools son funciones que la IA puede invocar directamente durante la conversación en modo `tool-driven`. También se usan internamente por el executor para verificación.

### system-tools.ts

- Leer/escribir ficheros del sistema
- Instalar paquetes apt
- Controlar servicios systemd
- Ejecutar comandos arbitrarios con sudo

### service-tools.ts

- Configurar BIND9 (zonas DNS)
- Configurar OpenLDAP (estructura, usuarios)
- Configurar Samba (shares, usuarios)
- Configurar WireGuard (claves, peers)
- Configurar Docker y Laia Agora

### verify-tools.ts

- Verificar estado de cada servicio
- Comprobar resolución DNS
- Hacer LDAP bind test
- Verificar gateway de Agora

Todas las tools devuelven un `ToolResultEnvelope` estándar:

```typescript
{
  success: boolean,
  retryable: boolean,         // si true, el executor puede reintentar
  observed_state: {...},      // estado del sistema observado
  changed_files: string[],    // ficheros que la tool modificó
  services_touched: string[], // servicios que la tool tocó
  rollback_hint?: string,     // cómo deshacer si falla
  error?: string,
  output?: unknown
}
```

---

## Flujo de datos resumido

```
SystemScan ──────────────────────────────────────────────────────────────┐
                                                                          ↓
BootstrapResult ──→ conversation.ts ──→ InstallerConfig ──→ plan-generator.ts
                           ↓                                       ↓
               ConversationIntent               InstallStep[] (plan determinista)
                           ↓                                       ↓
                    agentic.ts ──────────────→ ActionProposal[] (con verificación)
                                                       ↓
                                              executor.ts
                                         ┌─────────────────────┐
                                         │  HITL aprobación    │
                                         │  Ejecución streaming│
                                         │  Verificación activa│
                                         │  Reparación IA      │
                                         └─────────────────────┘
                                                       ↓
                                              Sistema configurado +
                                              Laia Agora validada
```

---

## Los prompts del sistema (`install-prompts/`)

Los prompts que guían a la IA durante la conversación están en ficheros Markdown:

| Fichero                    | Qué contiene                                        |
| -------------------------- | --------------------------------------------------- |
| `00-system-context.md`     | Contexto del servidor y capacidades de Laia Arch    |
| `01-company-profile.md`    | Preguntas sobre la empresa                          |
| `02-access-model.md`       | Usuarios, roles, acceso remoto                      |
| `03-services-selection.md` | Guía para que la IA ayude a seleccionar servicios   |
| `04-security-policy.md`    | Política de seguridad                               |
| `05-data-compliance.md`    | GDPR, backups, retención                            |
| `06-plan-generation.md`    | Instrucciones para la fase de confirmación del plan |

Son editables sin tocar código TypeScript, lo que permite ajustar el comportamiento de la IA sin recompilar.

---

## Presets

Un preset es una `InstallerConfig` guardada en disco. Permite reutilizar una configuración probada:

```bash
laia-arch install --preset empresa-base
laia-arch install --list-presets
```

Con preset, la Fase 2 (conversación) se salta completamente. `agentic.ts/buildConversationIntent()` reconstruye el `ConversationIntent` directamente desde la config guardada.

Los presets se guardan al final de una instalación exitosa cuando el usuario lo confirma.
Son la forma estándar de trabajar en sesiones de VM desechables.

---

## Seguridad

- Las contraseñas de servicios **nunca pasan por el contexto de la IA**
- Las credenciales se guardan en el keyring del sistema (secret-tool / macOS security) con fallback a `~/.laia-arch/credentials/` con permisos 600
- Las contraseñas LDAP se pasan a los comandos ldap\* mediante fichero temporal (no por argumento CLI, para que no aparezcan en `ps aux`)
- El acceso sudo se configura temporalmente en `/etc/sudoers.d/laia-arch` y se ofrece revocar al terminar
- Los ficheros sensibles se crean con `mode: 0o600`

---

## Lecciones aprendidas de instalaciones reales

Estos son errores que ya causaron fallos y están corregidos. No repetirlos:

| Problema               | Error cometido                                  | Solución correcta                                                                                                                                  |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sintaxis sudoers       | Usar `!NOPASSWD` para prohibir comandos         | `!NOPASSWD` es sintaxis inválida — provoca rechazo silencioso de todo el archivo. Las restricciones se implementan omitiendo comandos de la lista. |
| ldapadd no interactivo | Usar `-W` para que pida contraseña              | `-W` bloquea en instalación sin terminal interactiva. Usar `-y` con archivo temporal chmod 600 y trap EXIT.                                        |
| Archivos LDIF          | Generar con `\n` literal                        | Los LDIF requieren saltos de línea reales. Un `\n` literal corrompe las entradas silenciosamente.                                                  |
| ObjectClasses LDAP     | Combinar `groupOfNames` y `posixGroup`          | Son incompatibles. Elegir uno según el caso.                                                                                                       |
| JSON de la IA          | Confiar en JSON limpio                          | Las respuestas pueden venir envueltas en bloques markdown. `extractJson` debe manejarlo explícitamente.                                            |
| Zonas DNS BIND9        | Asumir carga automática post-instalación        | Las zonas requieren un paso explícito de carga. Sin ese paso el servidor no las sirve.                                                             |
| Archivos LDIF          | Generar el archivo y asumir que ya está cargado | Generar y ejecutar `ldapadd` son dos pasos separados. Ambos deben verificarse.                                                                     |
