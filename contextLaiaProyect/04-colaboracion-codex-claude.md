# LAIA — Guía de colaboración para Codex y Claude Code

## Objetivo de este documento

Alinear el trabajo de los agentes de código para que no construyan un proyecto distinto del que se quiere construir.

## Regla principal

Antes de implementar una mejora, distinguir siempre entre:

- visión del proyecto
- estado real del repo
- siguiente paso útil y seguro

## Qué deben asumir Codex y Claude Code

Deben asumir esto como verdad del proyecto:

- `Laia Arch` es el núcleo actual del trabajo
- el problema principal no es añadir más features, sino cambiar el modelo mental del instalador
- el instalador debe evolucionar hacia agente operando con herramientas y verificación
- el plan determinista actual es valioso como fallback y no debe destruirse sin reemplazo seguro

## Qué no deben hacer

- describir como implementado algo que solo es visión
- desviar el foco a Nemo o paneles antes de cerrar Arch
- proponer reescrituras completas si puede hacerse migración incremental
- confundir conversación adaptativa con arquitectura agentic real

## Forma correcta de trabajar

### 1. Leer primero el estado real

Antes de diseñar cambios:

- revisar instalador
- revisar herramientas
- revisar rescate
- revisar verificación

### 2. Cambiar una capa cada vez

Orden recomendado:

- motor de instalación
- rescate
- verificación
- despliegue de Agora

### 3. Dejar trazabilidad

Cada cambio importante debe dejar claro:

- qué problema resuelve
- qué parte del roadmap mueve
- qué cambia del comportamiento del sistema

### 4. Mantener documentación viva

Si el código cambia la realidad del proyecto:

- actualizar `01-estado-actual.md`
- actualizar `03-roadmap.md`

## Reparto práctico entre agentes

Codex encaja bien para:

- análisis estructural del repo
- refactors amplios
- documentación técnica viva
- integración entre piezas

Claude Code encaja bien para:

- iteración rápida sobre prompts y flujos conversacionales
- definición de comportamiento agente a agente
- diseño y reescritura de lógica de instalación

## Regla de coordinación

Si ambos agentes trabajan sobre LAIA:

- usar esta carpeta como referencia compartida
- no asumir que el otro conoce la última decisión si no está escrita aquí
- tratar el roadmap como contrato operativo mínimo

## Resultado esperado

Si Codex y Claude Code se coordinan bien, el proyecto debe avanzar hacia una arquitectura donde:

- la visión siga clara
- el código no se desvíe
- el estado real quede documentado
- cada iteración acerque de verdad a `Laia Arch` al rol de agente instalador experto
