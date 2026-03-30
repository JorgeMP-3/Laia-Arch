# Plan de integración de Paperclip

## Prerequisitos antes de integrar

Antes de cualquier integración real, deben cumplirse estas condiciones:

### 1. Prioridad del roadmap respetada

Bloque A debe estar cerrado o muy cerca de cierre.

En términos prácticos:

- `Laia Arch` debe estar estable como instalador híbrido real
- `Laia Agora` base debe arrancar y verificarse de forma fiable
- no debe abrirse un frente que compita con Fase 4

### 2. Gateway de Agora estable

El gateway base de `Laia Agora` debe estar funcionando de forma consistente en
`18789`, porque esa sería la costura principal del POC.

### 3. Reglas de seguridad y ownership definidas

Debe quedar por escrito:

- qué aprobaciones pertenecen a Paperclip
- qué aprobaciones siguen siendo exclusivas de LAIA
- qué agentes pueden ser orquestados desde Paperclip
- qué superficies quedan fuera por ser privilegiadas

### 4. Alcance del POC acotado

El POC no debe intentar “meter Paperclip en todo”.

Debe comenzar con un flujo mínimo y medible, por ejemplo:

- una tarea asignada desde Paperclip
- invocación al gateway de LAIA
- ejecución por un agente ya existente
- trazabilidad completa del ciclo

### 5. Criterio de descarte previo

Antes de empezar, debe aceptarse que el POC puede terminar en descarte.

La finalidad es responder si Paperclip aporta valor real a Bloque B, no forzar
su adopción porque el concepto suene bien.

## Fases de integración con criterios de entrada y salida

### Fase 0 — Investigación y decisión documental

**Entrada**

- documentación local de LAIA actualizada
- revisión del repo oficial `paperclipai/paperclip`
- análisis del adaptador `openclaw_gateway`

**Trabajo**

- evaluar encaje conceptual
- documentar arquitectura futura
- dejar una decisión explícita

**Salida**

- documentos de `paperclip-integration/` completos
- decisión inicial: `posponer`
- criterios claros para un POC posterior

### Fase 1 — POC aislado fuera de producción

**Entrada**

- Bloque A cerrado o casi cerrado
- gateway estable en `18789`
- entorno de pruebas aislado disponible

**Trabajo**

- desplegar Paperclip como servicio separado
- configurar base de datos propia
- crear un agente Paperclip que use `openclaw_gateway`
- conectarlo contra una instancia de LAIA/OpenClaw existente

**Salida**

- conexión Paperclip -> OpenClaw/LAIA verificada
- flujo básico de ejecución completado sin tocar producción

### Fase 2 — Validación funcional mínima

**Entrada**

- POC desplegado y conectando correctamente

**Trabajo**

- ejecutar una tarea simple de extremo a extremo
- comprobar persistencia de sesión
- medir trazabilidad y claridad de responsabilidades
- validar separación entre gobernanza Paperclip y aprobaciones técnicas LAIA

**Salida**

- evidencia de valor o de fricción real
- lista de beneficios concretos y costes concretos

### Fase 3 — Decisión de adopción o descarte

**Entrada**

- resultados funcionales del POC
- evaluación técnica y operativa compartida

**Trabajo**

- decidir si Paperclip:
  - se descarta
  - se mantiene solo como herramienta interna
  - se convierte en capa real de coordinación para Bloque B

**Salida**

- decisión final argumentada
- actualización del roadmap si cambia el plan de Bloque B

Regla central de todas las fases:

- si en cualquier momento el POC empieza a invadir el cierre de Bloque A, se
  pausa o se descarta

## Archivos del repo afectados

### Alcance actual

En el estado actual, los archivos afectados deben limitarse a documentación:

- `context_LAIA/paperclip-integration/01-evaluacion.md`
- `context_LAIA/paperclip-integration/02-arquitectura-propuesta.md`
- `context_LAIA/paperclip-integration/03-plan-de-integracion.md`
- `context_LAIA/paperclip-integration/04-decision.md`
- `context_LAIA/README.md`

### Alcance futuro máximo para un POC

Si más adelante se hace un POC, el alcance en este repo debería mantenerse
estrecho:

- configuración o documentación de integración del gateway
- quizá una superficie pequeña de soporte alrededor del método `agent`
- quizá documentación operativa del despliegue

Lo que no debe prometerse desde este documento:

- cambios en `src/installer/**`
- rehacer `Laia Agora` para acomodar Paperclip
- convertir Paperclip en dependencia estructural del instalador

La integración futura, si ocurre, debe colgar de la frontera del gateway, no de
una modificación profunda del corazón de Bloque A.

## Tests de validación

### Test 1 — Invocación básica

Paperclip debe ser capaz de invocar a LAIA mediante el adaptador
`openclaw_gateway` y completar una ejecución simple sobre el método `agent`.

### Test 2 — Preservación de `sessionKey`

La sesión resuelta por el adaptador debe mantenerse de forma consistente entre
ejecuciones, sin romper el modelo actual de sesiones del gateway.

### Test 3 — Trazabilidad completa

Debe poder seguirse una tarea de extremo a extremo:

- issue creado o asignado
- heartbeat o invocación manual
- llamada al gateway
- respuesta del agente
- estado final visible

### Test 4 — Separación de aprobaciones

Debe verificarse que:

- Paperclip puede gestionar aprobaciones de negocio o de gobernanza
- LAIA mantiene las aprobaciones técnicas del host
- una aprobación en Paperclip no autoriza por sí sola operaciones privilegiadas

### Test 5 — Degradación segura

Si Paperclip cae o el gateway no responde:

- no debe corromper el estado del gateway
- no debe romper `Laia Agora` base
- no debe quedar el sistema dependiente de Paperclip para operar

### Test 6 — No invasión de Bloque A

La validación final del POC debe confirmar que la prueba no exigió cambios en
el instalador ni abrió una dependencia estructural nueva para `Laia Arch`.
