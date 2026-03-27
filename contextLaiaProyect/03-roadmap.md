# LAIA — Roadmap vivo

## Cómo leer este roadmap

Este documento no es una promesa cerrada.
Es una hoja de ruta viva que debe actualizarse cuando cambie el estado real del proyecto.

Regla:

- si algo se implementa, se mueve de "pendiente" a "hecho"
- si algo cambia de enfoque, se reescribe aquí
- si algo sigue siendo visión, no se marca como completado

---

## Objetivo principal actual

Cerrar `Laia Arch` como agente instalador híbrido real y dejar el ecosistema base funcionando:
host configurado + `Laia Agora` base operativa.

No abrir frentes nuevos hasta que esto esté cerrado.

---

## Mapa completo del proyecto

El proyecto tiene dos grandes bloques:

**Bloque A — Laia Arch como instalador**
Fases 0–4. El trabajo activo ahora mismo.

**Bloque B — El ecosistema post-instalación**
Fases 5–8. Empieza cuando Arch esté cerrado.
Incluye la UI de Arch, Agora como producto real y Nemo como acceso externo.

---

## BLOQUE A — Laia Arch como instalador

### Fase 0 — Base ya existente

Estado: `completada`

Incluye:

- identidad propia `laia-arch`
- instalador conversacional con modos `tool-driven` (Automático), `guided` (Asistido) y `adaptive` (Adaptativo)
- escaneo del sistema
- presets
- credenciales seguras
- herramientas reales del sistema
- ejecución con HITL
- modo rescate integrado como `ai-rescue` en el mismo flujo del executor
- rollback por paso
- reanudación con tres caminos (reanudar / reiniciar / desinstalar y reinstalar)
- preservación de credenciales y perfil de bootstrap en clean restart
- 28 tests verdes en el área del instalador

Resultado:

- existe una base sólida sobre la que evolucionar

---

### Fase 1 — Motor agentic híbrido

Estado: `completada`

Meta:

- que el motor principal sea `observar -> decidir -> ejecutar -> verificar -> reparar`
- el razonamiento del agente gobierna la instalación, no el plan fijo

Trabajo previsto:

- hacer que `adaptive` y `tool-driven` usen el motor agentic como camino principal
- dejar `plan-generator` como fallback seguro, no como camino por defecto

Avance actual:

- tipos agentic completos: `ConversationIntent`, `ActionProposal`, `InstallSessionState`, `VerificationRequirement`
- `buildConversationIntent()` extrae intención desde config o desde conversación real
- `buildActionProposalsFromPlan()` convierte el plan en propuestas con verificación declarada por servicio
- `buildAdaptiveExecutionPlanFromIntent()` y `buildActionProposalsFromIntent()` ya construyen el camino adaptativo directo sin pasar por `plan-generator.ts`
- `createInstallSessionState()` inicializa sesión persistible con snapshot y propuestas
- el executor usa `ActionProposal` como unidad primaria — todo por `proposal.id`
- `executeActionProposals()` ejecuta propuestas directas y recorre la instalación por proposals, no por pasos de un plan cerrado previo
- `prepareInstallerExecutionArtifacts()` hace que `src/installer/index.ts` use ese camino en modo `adaptive`
- política de reparación: 2 reintentos automáticos → verificación-retry → diagnóstico IA → HITL
- verificación activa: false-greens bloqueados (código 0 + verificación fallida = fallo real)
- el fallback determinista sigue activo para `guided`, `tool-driven` y para cualquier degradación segura del camino adaptativo

Criterio de cierre:

- la instalación en modo `adaptive` ya no depende por defecto de un plan cerrado previo

Responsable: Codex (motor) + Claude Code (conversación y contrato del agente)

Resultado observable de cierre:

- una sesión `adaptive` completa puede prepararse y ejecutarse sin pasar por `plan-generator.ts`
- el camino determinista sigue intacto y cubierto por `plan-generator.test.ts`

Siguiente mejora natural:

- hacer que el razonamiento adaptativo diverja más del catálogo actual de comandos cuando el estado observado del host ya permita reutilizar componentes instalados

---

### Fase 2 — Unificar instalación y rescate

Estado: `completada`

Meta:

- el rescate es el mismo agente con más libertad diagnóstica, no otro modo mental

Avance actual:

- `ai-rescue` ya es un `RepairAttempt` con `strategy: "ai-rescue"` dentro del mismo flujo del executor
- el historial de reparaciones se persiste junto a la sesión
- varios problemas antes dependientes de rescate ya se absorbieron en el instalador base (Docker, Nginx, backup, Agora)
- el rescate recibe ahora memoria operativa explícita derivada del `InstallSessionState`
- el prompt de rescate incluye:
  - `ConversationIntent` original
  - historial de ejecuciones previas con salida y verificación resumidas
  - historial de reparaciones previas de la misma sesión

Criterio de cierre:

- un fallo entra en diagnóstico y reparación sin cambiar de modelo mental

Responsable: Codex

---

### Fase 3 — Verificación activa obligatoria

Estado: `completada`

Meta:

- ningún paso se considera completado solo por devolver código 0

Avance actual:

- `verifyProposal()` ejecuta comprobaciones reales por tipo de servicio
- verificación fallida fuerza `status = "failed"` aunque el comando devolviera código 0
- tipos declarados: `service-active`, `dns-resolution`, `ldap-bind`, `samba-share`, `wireguard-active`, `docker-operational`, `nginx-config`, `backup-test`, `gateway-health`, `hostname-configured`, `package-installed`, `path-exists`, `sysctl-value`
- Cobertura según sesión: `buildActionProposalsFromPlan()` pasa de 11 propuestas sin verificación a 0 y las pruebas exigen verificación explícita en todo el plan.
- verificaciones endurecidas con fallback `sudo -n`

Criterio de cierre:

- todo paso importante termina con evidencia de estado observado real

Responsable: Codex

---

### Fase 4 — MVP de Laia Agora base

Estado: `en progreso`

Meta:

- el instalador deja `Laia Agora` operativa y verificada como base del ecosistema

Avance actual:

- el plan genera pasos `agora-01` a `agora-03`: directorios, compose, gateway
- `agora-03` tiene retry loop de 90 segundos (18 × 5s) antes de declarar fallo
- `agora-03` tiene verificación `gateway-health` declarada en su `ActionProposal`
- flujo endurecido tras instalaciones reales: config mínima, `--allow-unconfigured`, permisos correctos

Pendiente:

- seguir validando el flujo completo en instalaciones reales de punta a punta

Criterio de cierre:

- tras la instalación, la empresa tiene host configurado y Agora base funcionando en `18789`

Responsable: Codex + Claude Code (integración final)

---

## BLOQUE B — El ecosistema post-instalación

Estas fases empiezan cuando el Bloque A esté cerrado.
No abrir ninguna de estas antes de tener Arch + Agora base funcionando.

---

### Fase 5 — Laia Arch post-instalación

Estado: `pendiente`

Contexto:

Cuando Laia Arch termina la instalación, se auto-desactiva.
Para que sea útil como herramienta de mantenimiento del servidor, necesita:

- un mecanismo de reactivación seguro
- una interfaz propia para administrar el sistema

Meta:

- Laia Arch puede reactivarse desde el servidor físico con una contraseña específica
- Laia Arch tiene una UI propia de control del servidor (versión mejorada de la interfaz actual de OpenClaw)
- desde esa UI se puede administrar el servidor, crear nuevas herramientas para la empresa y gestionar el ecosistema

Trabajo previsto:

- implementar el script de reactivación con contraseña específica (no la del sistema)
- diseñar e implementar la UI de control del servidor
- definir qué puede hacer Arch desde esa UI y con qué límites
- decidir si la UI convive con Cockpit o lo reemplaza para el administrador

Criterio de cierre:

- el administrador puede reactivar Arch desde el host, operar el servidor desde la UI, y volver a desactivarlo

---

### Fase 6 — Laia Agora como producto empresarial

Estado: `visión`

Contexto:

Laia Agora es el centro de trabajo diario del equipo.
La visión es un espacio integrado que reúne lo que hoy hacen herramientas separadas.

Meta:

- espacio integrado tipo ClickUp + Notion + Figma:
  - gestión de proyectos y tareas
  - documentos y base de conocimiento
  - colaboración creativa
  - comunicación interna
- corre en Docker, aislado del host
- acceso desde la red local y VPN
- autenticación con el mismo LDAP que el resto del sistema

Trabajo previsto (a definir en detalle cuando llegue el momento):

- diseñar la arquitectura de Agora como producto
- Existe `agora-arquitectura.md` (documento de arquitectura) y propone fases internas de construcción: Fase 1 MVP de valor mínimo, Fase 2 integración del agente, Fase 3 comunicación interna, Fase 4 escalada a Nemo, Fase 5 capas empresariales avanzadas
- decidir qué construir propio y qué integrar de herramientas existentes
- implementar el panel principal
- conectar con LDAP para roles y permisos
- definir los contratos con Arch (qué puede pedirle Agora a Arch)

Criterio de cierre:

- el equipo puede gestionar proyectos, documentos y tareas desde Agora sin herramientas externas

---

### Fase 7 — Laia Nemo como acceso externo

Estado: `visión — producción estimada Q3 2026`

Contexto:

Laia Nemo es la capa de acceso rápido desde cualquier lugar en cualquier momento.
Empleados que están fuera de la oficina pueden acceder desde WhatsApp, Telegram, Slack o web pública.
Tiene privilegios mínimos — no puede tocar configuración ni operaciones críticas.
Si la tarea lo requiere, escala a Agora.

Meta:

- acceso desde WhatsApp, Telegram, Slack y web pública
- privilegios mínimos basados en el rol LDAP del usuario
- corre en Docker, en red completamente aislada de Agora
- sin comunicación directa entre contenedores — todo pasa por el bus inter-agente

Trabajo previsto (a definir en detalle cuando llegue el momento):

- implementar el bus inter-agente con audit trail
- configurar los canales de mensajería
- definir las políticas de acceso por rol
- implementar el escalado desde Nemo a Agora

Criterio de cierre:

- un comercial puede consultar campañas o tareas desde su móvil sin conectarse a la VPN

---

### Fase 8 — Capas empresariales avanzadas

Estado: `visión posterior`

Incluye:

- monitor de seguridad del ecosistema
- conectores de métricas de campañas (Meta Ads, Google Ads)
- políticas operativas completas por rol
- integración con herramientas externas de la agencia

---

## Próximas acciones concretas

En este orden. No saltar a la siguiente sin cerrar la anterior.

**1. Fase 1 — Motor agentic (cerrada)**

- `adaptive` ya ejecuta proposals directas
- mantener el fallback determinista intacto

**2. Fase 2 — Unificar rescate (cerrada)**

- Codex: rescate unificado con memoria operativa explícita desde la sesión

**3. Cerrar Fase 3 — Verificación obligatoria (cerrada)**

- Codex: verificación explícita asegurada en el plan completo (0 propuestas sin verificación)

**4. Cerrar Fase 4 — Agora base**

- Validar el flujo `agora-01` a `agora-03` en instalaciones reales de punta a punta

**5. Solo después: empezar Bloque B**

- Arrancar con Fase 5 (Arch post-instalación) antes de tocar Agora producto o Nemo

---

## Riesgos principales

### Riesgo 1

Quedarse en un "instalador mejorado" sin llegar a motor agentic real.

Mitigación:

- mover el centro del sistema al estado observado y a las herramientas
- el criterio de cierre de Fase 1 es observable: la instalación adaptativa no depende del plan fijo

### Riesgo 2

Abrir el Bloque B antes de cerrar el Bloque A.

Mitigación:

- no tocar UI de Arch, Agora producto ni Nemo hasta que Arch + Agora base estén cerrados
- el roadmap es el contrato — si alguien propone trabajo del Bloque B antes de tiempo, rechazarlo

### Riesgo 3

Romper la base estable actual por una reescritura excesiva.

Mitigación:

- estrategia híbrida siempre
- conservar `plan-generator` como fallback
- cambiar una capa cada vez

---

## Registro de actualización

### 2026-03-26

- Se documenta el estado real del repo.
- Se fija como prioridad transformar `Laia Arch` en motor híbrido agentic.
- Se fija como alcance práctico siguiente el MVP `Laia Arch + Laia Agora base`.
- Se implementan tipos agentic, intención estructurada, propuestas derivadas del plan y sesión persistida.
- Se añade verificación por propuesta y despliegue base de `Laia Agora` en el plan de instalación.
- Workstream B (motor técnico) completado:
  - `agentic.ts`: `buildConversationIntent`, `buildActionProposalsFromPlan`, `createInstallSessionState`
  - `executor.ts`: `ActionProposal` como unidad primaria, política de reparación 2-retry → AI → HITL, false-green bloqueado
  - `plan-generator.ts`: retry loop 90s en `agora-03`
  - `tools/index.ts`: inferencia de `changed_files` corregida para wireguard y hostname
  - primeras pruebas de la capa agentic y de sesión persistida
- Se endurece la ruta de reanudación del instalador:
  - persistencia correcta tras rescate exitoso
  - opción `d` para desinstalar y reinstalar
  - preservación/restauración de credenciales y perfil de bootstrap en clean restart
- Se absorben en el instalador varios arreglos antes dependientes de rescate:
  - DNS base válida
  - Docker con grupo del usuario invocador
  - `Laia Agora` con config mínima y permisos correctos
  - Nginx con verificación robusta
  - backup con `find -type f` y verificación con fallback de privilegios
- Cobertura actual del área del instalador: 28 tests verdes.

### 2026-03-27

- Se añade el Bloque B al roadmap con la visión completa del ecosistema post-instalación.
- Se documenta Fase 5 (Laia Arch post-instalación): mecanismo de reactivación con contraseña y UI de control del servidor.
- Se documenta Fase 6 (Laia Agora como producto): espacio integrado tipo ClickUp + Notion + Figma, en Docker, con LDAP.
- Se documenta Fase 7 (Laia Nemo): acceso externo desde WhatsApp, Telegram, Slack y web, Q3 2026.
- Se añade regla explícita: no abrir Bloque B antes de cerrar Bloque A.
- Se actualiza `02-proyecto-laia.md` con los tres modos de instalación y la visión de los tres agentes.
- Se actualiza `01-estado-actual.md` con tabla de nombres UI vs código y elementos post-instalación pendientes.
- Se actualiza `06-como-funciona-por-dentro.md` con lecciones aprendidas y estado real del modo adaptativo.
- Se cierra `Fase 3 — Verificación activa obligatoria` al asegurar verificación explícita en todo el plan (0 propuestas sin verificación) y ampliar `VerificationRequirement.kind` con evidencia observada adicional.
- En `Fase 6`, se incorpora el documento `agora-arquitectura.md` y sus fases internas de construcción (1-5) para Laia Agora como producto empresarial.
