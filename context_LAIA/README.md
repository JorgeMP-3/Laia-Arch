# Contexto del Proyecto LAIA

Este directorio y sus carpetas hermanas forman la fuente de verdad operativa del proyecto LAIA.

El contexto está dividido en tres carpetas con responsabilidades distintas:

## Estructura de las tres carpetas

### `context_LAIA/` — Visión estática del proyecto (estás aquí)

Contiene la visión, el propósito, roadmap y versionamiento del proyecto. Es el punto de partida para entender qué es LAIA y hacia dónde va.

**Para IAs y desarrolladores (EMPIEZA AQUÍ):**

- **`INSTRUCCIONES-PARA-IAS.md`** 🤖 — Paso a paso: qué archivo afecta, qué versión poner, qué comando ejecutar
- **`QUICK-START-versionamiento.md`** ⚡ — Cheat sheet de comandos listos para copiar-pegar

**Documentación completa:**

- `02-proyecto-laia.md` — Qué es LAIA y para qué existe
- `03-roadmap.md` — Plan de evolución del proyecto, fases y estado actual
- `04-guia-versionamiento.md` — Guía práctica con ejemplos detallados
- `05-versionamiento.md` — Especificación técnica del sistema de versiones

### `context_Code/` — Código y trabajo de IAs

Contiene el estado real del código, la arquitectura interna y las reglas de trabajo para los agentes. Cualquier IA debe leer esto antes de tocar código.

- `00-como-trabajan-las-ias.md` — **Entrada obligatoria para IAs.** Reglas, protocolos y resumen de carpetas
- `01-estado-actual.md` — Qué está implementado de verdad a fecha de esta revisión
- `04-colaboracion-codex-claude.md` — Reglas prácticas de trabajo para agentes de código
- `06-como-funciona-por-dentro.md` — Arquitectura interna detallada: fases, archivos, flujo de datos
- `agora-arquitectura.md` — Diseño de Laia Agora
- `sesion-activa.md` — Qué se está haciendo ahora mismo y qué archivos están reservados

### `context_Guias/` — Guías para el administrador humano (Jorge)

Contiene documentación pensada para el administrador del proyecto. No es relevante para las IAs.

- `07-guia-programacion-para-entender-laia.md` — Conceptos técnicos explicados de forma accesible
- `08-guia-git-github-y-comandos.md` — Git, GitHub y compilación de Laia Arch

## Principio editorial

Esta documentación distingue siempre entre:

1. Lo que ya existe de verdad en el repo
2. Lo que está parcialmente construido
3. Lo que sigue siendo visión o diseño futuro

Fecha base de esta versión: `2026-03-26`.
Última revisión estructural: `2026-03-28`.
