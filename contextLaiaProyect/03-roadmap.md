# LAIA — Roadmap vivo

## Cómo leer este roadmap

Este documento no es una promesa cerrada.
Es una hoja de ruta viva que debe actualizarse cuando cambie el estado real del proyecto.

Regla:

- si algo se implementa, se mueve de “pendiente” a “hecho”
- si algo cambia de enfoque, se reescribe aquí
- si algo sigue siendo visión, no se marca como completado

## Objetivo principal actual

Objetivo vigente:

Transformar `Laia Arch` desde un instalador determinista con capa conversacional hacia un agente instalador híbrido, y dejar como siguiente resultado práctico un MVP funcional de `Laia Arch + Laia Agora base`.

## Estado por fases

### Fase 0 — Base ya existente

Estado: `ya construida en gran parte`

Incluye:

- identidad propia `laia-arch`
- instalador conversacional
- escaneo del sistema
- presets
- credenciales seguras
- herramientas reales del sistema
- ejecución con HITL
- modo rescate
- rollback por paso
- reanudación

Resultado:

- existe una base sólida sobre la que evolucionar

### Fase 1 — Pasar a motor agentic híbrido

Estado: `en progreso`

Meta:

- que el motor principal sea `observar -> decidir -> ejecutar -> verificar -> reparar`

Trabajo previsto:

- introducir estado interno de instalación y snapshot del sistema
- separar intención empresarial de plan técnico fijo
- hacer que `adaptive` y `tool-driven` usen el motor agentic como camino principal
- dejar `plan-generator` como fallback seguro

Avance actual:

- tipos agentic completos: `ConversationIntent`, `ActionProposal`, `InstallSessionState`, `VerificationRequirement`
- `buildConversationIntent()` extrae intención desde config o desde conversación real
- `buildActionProposalsFromPlan()` convierte el plan en propuestas con verificación declarada por servicio
- `createInstallSessionState()` inicializa sesión persistible con snapshot y propuestas
- el executor usa `ActionProposal` como unidad primaria (approval/execution/repair/completed todo por `proposal.id`)
- política de reparación implementada: 2 reintentos automáticos → diagnóstico IA → HITL
- verificación activa: false-greens bloqueados (código 0 + verificación fallida = fallo real)
- clean restart ya preserva y restaura credenciales de instalación y perfil de bootstrap
- el reintento tras rescate ya persiste el estado final correcto del paso
- tests actuales del área del instalador: 28 tests verdes en `agentic.test.ts`, `executor.test.ts`, `plan-generator.test.ts` y `verify-tools.test.ts`
- todavía falta que el motor decida más allá del plan derivado (razonamiento libre en tiempo real)

Criterio de cierre:

- la instalación ya no depende por defecto de un plan cerrado previo

### Fase 2 — Unificar instalación y rescate

Estado: `parcialmente cerrada`

Meta:

- que el modo rescate sea una extensión natural del mismo agente

Avance actual:

- `ai-rescue` ya es un `RepairAttempt` con `strategy: “ai-rescue”` dentro del mismo flujo del executor
- el historial de reparaciones se persiste junto a la sesión
- varios problemas detectados por rescate ya se han movido al instalador base para evitar depender de la IA en Docker, Nginx, backup y Agora

Pendiente:

- unificar plenamente el historial operativo (instalación normal + rescate comparten contexto de forma explícita)

Criterio de cierre:

- un fallo normal entra en diagnóstico y reparación sin cambiar de modelo mental

### Fase 3 — Verificación activa obligatoria

Estado: `parcialmente cerrada`

Meta:

- que ningún paso se considere completado solo por devolver código 0

Avance actual:

- `verifyProposal()` ejecuta comprobaciones reales por tipo de servicio
- verificación fallida fuerza `status = “failed”` aunque el comando devolviera código 0
- tipos de verificación declarados: `service-active`, `dns-resolution`, `ldap-bind`, `samba-share`, `wireguard-active`, `docker-operational`, `nginx-config`, `backup-test`, `gateway-health`
- verificaciones endurecidas con fallback `sudo -n` para reducir falsos negativos por permisos

Pendiente:

- pasos sin `verification` declarada siguen aceptando código 0 como éxito (cobertura parcial)

Criterio de cierre:

- todo paso importante termina con evidencia de estado observado

### Fase 4 — MVP de Laia Agora base

Estado: `en progreso`

Meta:

- que el instalador deje desplegada `Laia Agora` como base operativa interna

Trabajo previsto:

- generar despliegue Docker específico de LAIA
- dejar Agora operativa en `18789`
- persistir config y workspace
- dejar plantillas del ecosistema listas

Avance actual:

- el plan genera pasos `agora-01` a `agora-03` para directorios, compose y gateway
- `agora-03` tiene un retry loop de 90 segundos (18 × 5s) antes de declarar fallo
- `agora-03` tiene verificación declarada `gateway-health` en su `ActionProposal`
- el flujo se ha endurecido tras instalaciones reales: config mínima, `--allow-unconfigured`, permisos correctos y validación de salud final
- queda seguir validando el flujo completo en instalaciones reales de punta a punta

Criterio de cierre:

- tras la instalación, la empresa tiene host configurado y Agora base funcionando

### Fase 5 — Ecosistema operativo mínimo

Estado: `pendiente`

Meta:

- conectar mejor la jerarquía `Arch -> Agora -> Nemo`

Trabajo previsto:

- definir contratos claros de escalado entre agentes
- endurecer límites de privilegio
- dejar Nemo como scaffold técnico listo para crecer

Criterio de cierre:

- el ecosistema está estructurado de forma coherente aunque Nemo no sea todavía producción

### Fase 6 — Capas empresariales avanzadas

Estado: `visión posterior`

Incluye:

- panel de Arch
- panel de Agora
- bus inter-agente dedicado
- monitor de seguridad
- conectores de métricas
- capa externa madura de Nemo

## Próximas acciones recomendadas

Orden recomendado de trabajo:

1. redefinir el motor del instalador
2. unificar rescate con instalación
3. imponer verificación activa
4. cerrar despliegue base de Agora
5. refinar contratos del ecosistema completo

## Riesgos principales

### Riesgo 1

Quedarse en un “instalador mejorado” sin llegar a motor agentic real.

Mitigación:

- mover el centro del sistema al estado observado y a las herramientas

### Riesgo 2

Intentar construir paneles y capas externas antes de cerrar Arch.

Mitigación:

- no abrir demasiados frentes antes de cerrar el núcleo instalador

### Riesgo 3

Romper la base estable actual por una reescritura excesiva.

Mitigación:

- estrategia híbrida
- conservar `plan-generator` como fallback

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

### 2026-03-26 — actualización posterior

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
