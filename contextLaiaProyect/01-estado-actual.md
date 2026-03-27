# LAIA — Estado actual del proyecto

## Resumen ejecutivo

El proyecto ya no es simplemente OpenClaw sin cambios. En el repo actual existe una línea de producto propia llamada `Laia Arch`, con identidad, binario, instalador conversacional, herramientas del sistema, modo rescate, gestión de credenciales y plantillas del ecosistema.

Aun así, el estado real hoy es este:

- `Laia Arch` ya existe como producto funcional de instalación.
- `Laia Arch` ya tiene un camino agentic real en modo `adaptive`: puede generar `ActionProposal` directas desde `ConversationIntent` sin pasar por `plan-generator.ts`.
- `Laia Agora` existe como despliegue base funcional dentro del flujo de instalación, pero no como producto empresarial completo.
- `Laia Nemo` existe como concepto y plantilla de workspace, pero no como capa de acceso externo lista para producción.
- El proyecto LAIA completo todavía no está terminado.

## Nota sobre los nombres de los modos de instalación

Los modos tienen dos nombres: el nombre en la UI (lo que ve el administrador) y el nombre en el código.

| UI (lo que ve el admin) | Código (`InstallMode`) | Descripción                                                       |
| ----------------------- | ---------------------- | ----------------------------------------------------------------- |
| Automático              | `tool-driven`          | IA hace preguntas mínimas y ejecuta con tools predefinidas        |
| Asistido                | `guided`               | Guía fija de preguntas en orden fijo basada en `install-prompts/` |
| Adaptativo              | `adaptive`             | IA adapta la instalación según la empresa                         |

Cuando leas el código, verás los nombres del código. Cuando leas documentación de producto, verás los nombres de UI. Son lo mismo.

## Estado confirmado en el repositorio

### 1. Identidad del producto

Confirmado:

- `package.json` define el paquete como `laia-arch`.
- El binario principal es `laia-arch`.
- La descripción del paquete ya posiciona el proyecto como agente fundador del ecosistema LAIA.
- Existen constantes de daemon y nombres de servicio con prefijo `laia-arch`.

Conclusión:

- El fork ya tiene identidad propia a nivel de runtime, CLI y branding técnico.

### 2. Lo que ya está implementado de verdad

#### Instalador conversacional

Implementado:

- `src/installer/index.ts` orquesta bootstrap, escaneo, conversación, plan, credenciales y ejecución.
- `src/installer/conversation.ts` soporta modos `tool-driven`, `guided` y `adaptive`.
- `src/installer/conversation.ts` ya devuelve también una intención estructurada (`ConversationIntent`) además de la config de fallback.
- `install-prompts/00-06.md` define etapas editables para el modo guiado.
- `src/installer/presets/` y `presets/*.json` permiten configuraciones reutilizables.

#### Escaneo y entendimiento del host

Implementado:

- `src/installer/scanner.ts` detecta hardware, OS, red, servicios, puertos, software instalado y advertencias.
- El escaneo se guarda en `~/.laia-arch/last-scan.json`.

#### Planificación determinista

Implementado:

- `src/installer/plan-generator.ts` genera pasos reproducibles para:
  - hostname y base del sistema
  - DNS con BIND9
  - OpenLDAP
  - Samba
  - WireGuard
  - Docker
  - despliegue base de `Laia Agora`
  - Nginx
  - Cockpit
  - backups
- El plan ya incorpora endurecimientos operativos que nacieron de fallos reales de instalación:
  - DNS con zona mínima válida y TTL explícito
  - Docker añadiendo el usuario invocador al grupo `docker`
  - `Laia Agora` con `openclaw.json` mínimo, permisos compatibles con el contenedor y `healthcheck`
  - backup con retención por archivos (`find -type f`) para evitar falsos fallos en cron
- `src/installer/plan-generator.test.ts` ya cubre DNS, Docker, Agora y backup además del flujo LDAP.

#### Ejecución con HITL y reanudación

Implementado:

- `src/installer/executor.ts` ejecuta cada paso con streaming de salida.
- Hay soporte para `sudo`, heartbeat, timeout, reintentos transitorios y rollback por paso.
- La instalación persiste progreso y puede reanudarse.
- `ActionProposal` es la unidad primaria de ejecución: todo approval/execution/repair se traza por `proposal.id`.
- `src/installer/index.ts` ya decide entre dos caminos reales:
  - `adaptive` -> proposals directas del agente + fallback determinista si hace falta
  - `guided` / `tool-driven` -> `plan-generator.ts` como hasta ahora
- `src/installer/executor.ts` ya puede ejecutar proposals directas mediante `executeActionProposals()` sin depender de un plan cerrado previo para recorrer los pasos.
- Política de reparación implementada: 2 reintentos automáticos (restart servicios) → diagnóstico IA (rescue) → HITL.
- Verificación activa: éxito técnico (código 0) + verificación fallida = fallo real. No hay false-greens.
- Sesión completa persistida: `InstallSessionState` incluye snapshot, propuestas, ejecuciones, reparaciones, approvals.
- El reintento tras rescate ya deja el paso persistido como resuelto si realmente quedó bien; no se "olvida" al relanzar el instalador.
- La reanudación ofrece tres caminos: reanudar, reiniciar desde cero o desinstalar todo y reinstalar.
- La reinstalación limpia preserva y restaura automáticamente las credenciales generadas del plan y el perfil de autenticación del proveedor IA para no romper fases posteriores como LDAP.
- `src/installer/hitl-controller.ts` pide aprobación humana explícita.

#### Credenciales seguras

Implementado:

- `src/installer/credential-manager.ts` genera y guarda credenciales sin exponerlas a la IA.
- Usa llavero del sistema cuando es posible y fallback local restringido.

#### Herramientas reales del sistema

Implementado en `src/installer/tools/`:

- lectura y escritura de archivos
- comprobación de servicios y puertos
- instalación de paquetes
- activación de servicios
- configuración de hostname, DNS y WireGuard
- creación y verificación LDAP
- creación y verificación Samba
- verificación de cadena de servicios
- prueba de backups
- envelope normalizado para consumo agentic (`observed_state`, `changed_files`, `services_touched`, `rollback_hint`)
- fallback con `sudo -n` en verificaciones donde un usuario normal puede ver falsos fallos por permisos (`docker info`, test de backup, `nginx -t`)

#### Modo rescate

Implementado:

- `src/installer/executor.ts` tiene un modo rescate que se activa manualmente al aprobar o tras fallo.
- Está integrado como `ai-rescue` dentro del mismo `RepairAttempt` del executor — no es un carril separado.
- El rescate ya consume memoria operativa explícita de la misma sesión: `ConversationIntent` original + historial de ejecuciones + historial de reparaciones.
- Puede usar herramientas del instalador, leer logs y ayudar a diagnosticar.
- El rescate ya resuelve varios fallos reales del flujo, pero los fixes más repetidos se están absorbiendo en el instalador para que no dependan de la IA.

#### Desinstalación y utilidades operativas

Implementado:

- `src/installer/uninstaller.ts` detecta y elimina servicios instalados.
- `src/installer/updater.ts` existe como base para actualizar Laia Arch.

### 3. Lo que existe pero todavía está a medio camino

#### Adaptive realmente agentic

Implementado para el flujo actual del instalador:

- `buildActionProposalsFromIntent()` construye proposals directas desde `ConversationIntent`.
- `buildAdaptiveExecutionPlanFromIntent()` construye el plan fallback del camino agentic sin pasar por `plan-generator.ts`.
- `prepareInstallerExecutionArtifacts()` hace que `src/installer/index.ts` use ese camino en `adaptive`.
- `executeActionProposals()` ejecuta la cola de proposals directas; el plan queda solo como soporte para preview, persistencia, resumen y reanudación segura.
- Hay pruebas que validan el criterio observable:
  - `adaptive` no llama a `plan-generator.ts`
  - `guided` sigue usando el generador determinista
  - el fallback sigue vivo

Limitación honesta:

- el catálogo de comandos del camino agentic todavía refleja de cerca el catálogo actual del plan determinista; lo que cambió en esta fase es que el agente ya gobierna la ejecución adaptativa sin depender obligatoriamente del generador de planes.

#### Modo rescate unificado

Implementado en el executor:

- Existe y es útil.
- Está integrado como `ai-rescue` dentro del mismo `RepairAttempt` del executor.
- Comparte memoria operativa explícita con la instalación normal a partir del `InstallSessionState`.
- El prompt de rescate recibe ahora tres bloques estructurados:
  - `ConversationIntent` original
  - historial de ejecuciones previas de la sesión
  - historial de reparaciones previas de la sesión

Resultado:

- instalación normal y rescate ya no trabajan con memorias separadas; comparten la misma sesión persistida como contexto operativo real.

#### Verificación activa

Implementado para propuestas conocidas:

- `verifyProposal()` ejecuta comprobaciones reales tras cada paso.
- Verificación fallida fuerza `status = "failed"` aunque el comando devolviera código 0.
- `attemptAutomaticRepair()` hace 2 reintentos de restart antes de escalar a rescue.
- Parte de los falsos fallos detectados en instalaciones reales ya quedaron corregidos en el código base:
  - Docker operativo aunque `docker.sock` no fuese accesible por el usuario normal
  - `nginx -t` ejecutado con fallback de privilegios
  - backup verificado con fallback `sudo -n`
  - `Laia Agora` con permisos correctos en `openclaw.json`

Limitación actual:

- Las verificaciones ahora cubren el plan generado de extremo a extremo: `buildActionProposalsFromPlan()` pasa de 11 propuestas sin verificación a 0, y las pruebas exigen verificación explícita en todo el plan.
- Se amplía `VerificationRequirement.kind` para expresar evidencia observada adicional (`hostname-configured`, `package-installed`, `path-exists`, `sysctl-value`), ejecutadas por `executor.ts`.

#### Ecosistema de tres agentes

Parcial:

- Hay plantillas de workspace para `laia-arch`, `laia-agora` y `laia-nemo`.
- La visión de jerarquía ya está escrita en esas plantillas.
- `src/installer/plan-generator.ts` ya prepara un despliegue base de `Laia Agora` con Docker Compose y healthcheck en `18789`.
- El despliegue base de Agora ya no es solo conceptual: el plan lo genera, lo levanta y lo verifica con `gateway-health`.

Problema:

- El despliegue de Agora ya existe como base, pero sigue siendo un MVP y no cierra todavía el ecosistema completo.
- La UI de control de Laia Arch post-instalación no está implementada.
- El mecanismo de reactivación con contraseña no está implementado.
- La gestión continua de Agora y Nemo desde Laia Arch post-instalación no está implementada.

### 4. Lo que todavía no está implementado como producto real

No confirmado en el repo como solución ya terminada:

- UI propia de `Laia Arch` post-instalación (panel de control del servidor, versión mejorada de OpenClaw)
- mecanismo de reactivación de `Laia Arch` con contraseña desde el host físico
- panel de `Laia Agora` como aplicación core empresarial (tipo ClickUp + Notion + Figma)
- bus inter-agente dedicado con FastAPI y audit trail propio
- despliegue completo de `Laia Agora` como entorno empresarial terminado
- `Laia Nemo` productiva para WhatsApp, Telegram, Slack y web
- monitor de seguridad del ecosistema
- conector de métricas de campañas
- políticas operativas completas por rol empresarial en el producto final

## Diagnóstico honesto

### Qué es hoy

Hoy `Laia Arch` es un instalador serio, útil y bastante avanzado.

No es un simple script bash:

- conversa
- escanea
- usa herramientas reales
- gestiona credenciales con cuidado
- pide aprobación humana
- puede reanudar
- puede reiniciar limpio sin perder credenciales críticas del propio flujo
- tiene rescate

### Qué todavía no es

Todavía no es plenamente el agente instalador que define la visión LAIA.

La diferencia principal es esta:

- hoy la IA ya puede gobernar el flujo adaptativo sin `plan-generator.ts`, pero todavía no razona con libertad total sobre herramientas y estrategia como un sysadmin completamente abierto
- la visión exige que la IA observe el sistema, decida, ejecute, verifique y repare sobre la marcha
- ahora ya existe la estructura de intención, sesión, proposals, verificación y reparación persistida, y el modo `adaptive` ya la usa como camino real

## Tensión central del proyecto

La tensión técnica actual no es "falta de features".

La tensión real es esta:

- el proyecto ya tiene muchas piezas correctas
- pero el centro del sistema todavía es el plan fijo
- y debería pasar a ser el razonamiento operativo del agente

## Prioridad real

La prioridad correcta no es construir primero paneles, Nemo o métricas.

La prioridad correcta es:

1. convertir `Laia Arch` en un agente instalador híbrido de verdad
2. mantener el plan determinista actual como fallback seguro
3. cerrar después el MVP funcional de `Laia Agora`

## Definición práctica del estado actual

Frase corta:

`Laia Arch` ya existe y funciona, y el modo adaptativo ya instala a partir de proposals directas del agente; el siguiente salto ya no es desbloquear esa arquitectura, sino refinar cuánto razona y adapta sobre el estado real del host.

## Nota de coherencia documental (pendiente de aclaración)

- Codex detectó que `contextLaiaProyect/04-agentes-de-codigo.md` no existe; el protocolo operativo real está en `contextLaiaProyect/04-colaboracion-codex-claude.md` (pendiente de aclaración para el equipo).
