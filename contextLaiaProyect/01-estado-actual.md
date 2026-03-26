# LAIA — Estado actual del proyecto

## Resumen ejecutivo

El proyecto ya no es simplemente OpenClaw sin cambios. En el repo actual existe una línea de producto propia llamada `Laia Arch`, con identidad, binario, instalador conversacional, herramientas del sistema, modo rescate, gestión de credenciales y plantillas del ecosistema.

Aun así, el estado real hoy es este:

- `Laia Arch` ya existe como producto funcional de instalación.
- `Laia Arch` todavía funciona principalmente como un instalador determinista con IA encima.
- `Laia Agora` existe como visión de ecosistema y como plantilla de workspace, pero no como despliegue empresarial cerrado dentro del flujo final.
- `Laia Nemo` existe como concepto y plantilla de workspace, pero no como capa de acceso externo lista para producción.
- El proyecto LAIA completo todavía no está terminado.

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
- Política de reparación implementada: 2 reintentos automáticos (restart servicios) → diagnóstico IA (rescue) → HITL.
- Verificación activa: éxito técnico (código 0) + verificación fallida = fallo real. No hay false-greens.
- Sesión completa persistida: `InstallSessionState` incluye snapshot, propuestas, ejecuciones, reparaciones, approvals.
- El reintento tras rescate ya deja el paso persistido como resuelto si realmente quedó bien; no se “olvida” al relanzar el instalador.
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
- Puede usar herramientas del instalador, leer logs y ayudar a diagnosticar.
- El rescate ya resuelve varios fallos reales del flujo, pero los fixes más repetidos se están absorbiendo en el instalador para que no dependan de la IA.

#### Desinstalación y utilidades operativas

Implementado:

- `src/installer/uninstaller.ts` detecta y elimina servicios instalados.
- `src/installer/updater.ts` existe como base para actualizar Laia Arch.

### 3. Lo que existe pero todavía está a medio camino

#### Adaptive realmente agentic

Parcial:

- El modo `adaptive` ya existe a nivel conversacional.
- El executor ya usa propuestas derivadas del plan como unidad primaria de trabajo.
- Pero la ejecución real sigue dependiendo de un plan predeterminado generado después de la conversación.

Problema:

- La IA entiende contexto, pero no gobierna la instalación de extremo a extremo en tiempo real sin un plan previo.

#### Modo rescate

Parcial:

- Existe y es útil.
- Está integrado como `ai-rescue` dentro del mismo `RepairAttempt` del executor, no como carril completamente separado.
- Comparte ya bastante más contexto con la instalación normal que al principio.

Problema:

- Sigue faltando que el razonamiento operativo y el rescate usen exactamente el mismo bucle mental sin depender tanto del plan previo.

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

- Las verificaciones declaradas cubren servicios conocidos (dns, ldap, samba, wireguard, docker, agora).
- Pasos sin `verification` declarada siguen aceptando código 0 como éxito.

#### Ecosistema de tres agentes

Parcial:

- Hay plantillas de workspace para `laia-arch`, `laia-agora` y `laia-nemo`.
- La visión de jerarquía ya está escrita en esas plantillas.
- `src/installer/plan-generator.ts` ya prepara un despliegue base de `Laia Agora` con Docker Compose y healthcheck en `18789`.
- El despliegue base de Agora ya no es solo conceptual: el plan lo genera, lo levanta y lo verifica con `gateway-health`.

Problema:

- El despliegue de Agora ya existe como base, pero sigue siendo un MVP y no cierra todavía el ecosistema completo.

### 4. Lo que todavía no está implementado como producto real

No confirmado en el repo como solución ya terminada:

- panel de `Laia Arch` tipo web de aprobaciones en tiempo real
- panel de `Laia Agora` como aplicación core empresarial
- bus inter-agente dedicado con FastAPI y audit trail propio
- despliegue completo de `Laia Agora` como entorno empresarial terminado
- `Laia Nemo` productiva para WhatsApp, Telegram, Slack y web
- monitor de seguridad del ecosistema
- conector de métricas de campañas
- políticas operativas completas por rol empresarial en el producto final

## Diagnóstico honesto

## Qué es hoy

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

## Qué todavía no es

Todavía no es plenamente el agente instalador que define la visión LAIA.

La diferencia principal es esta:

- hoy la IA recopila contexto y luego activa un flujo determinista
- la visión exige que la IA observe el sistema, decida, ejecute, verifique y repare sobre la marcha
- ahora ya existe la estructura de intención, sesión, propuestas, verificación y reparación persistida, pero el razonamiento aún no gobierna toda la instalación de extremo a extremo

## Tensión central del proyecto

La tensión técnica actual no es “falta de features”.

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

`Laia Arch` ya existe y funciona, pero todavía está en transición desde “instalador con IA” hacia “agente IA que instala”.
