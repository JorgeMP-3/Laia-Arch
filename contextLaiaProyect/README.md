# Contexto del Proyecto LAIA

Este directorio existe para mantener una fuente de verdad operativa del proyecto LAIA mientras evoluciona.

No sustituye la documentación técnica del producto ni los prompts del instalador. Su función es otra:

- dejar claro qué es LAIA y qué no es
- reflejar el estado real confirmado en el repositorio
- mantener una hoja de ruta viva que se pueda ir corrigiendo
- alinear el trabajo entre Codex y Claude Code

## Documentos de esta carpeta

- `01-estado-actual.md` — estado real del proyecto a fecha de esta revisión
- `02-proyecto-laia.md` — explicación detallada de la visión del proyecto
- `03-roadmap.md` — plan de evolución del proyecto y del instalador
- `04-colaboracion-codex-claude.md` — reglas prácticas de trabajo para agentes de código
- `05-plan-ejecucion-codex-claude.md` — reparto operativo actual entre Codex y Claude Code
- `06-como-funciona-por-dentro.md` — arquitectura interna detallada: fases, archivos, flujo de datos

## Cómo usar esta carpeta

- Antes de tocar arquitectura, leer `01-estado-actual.md` y `02-proyecto-laia.md`.
- Antes de implementar una fase nueva, actualizar `03-roadmap.md`.
- Cuando una decisión cambie el alcance o el enfoque, reflejarla aquí antes o junto con el código.
- Si una idea aún no está implementada, debe quedar marcada como visión, no como hecho.

## Principio editorial

Esta carpeta debe distinguir siempre entre tres cosas:

1. lo que ya existe de verdad en el repo
2. lo que está parcialmente construido
3. lo que sigue siendo visión o diseño futuro

Fecha base de esta versión: `2026-03-26`.

Última revisión alineada con el código: `2026-03-26` tras endurecer reanudación, reinstalación limpia, verificaciones y despliegue base de `Laia Agora`.
