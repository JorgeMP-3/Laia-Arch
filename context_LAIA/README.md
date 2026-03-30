# Contexto del Proyecto LAIA

Este directorio y sus carpetas hermanas forman la fuente de verdad operativa del proyecto LAIA.

El contexto está dividido en tres carpetas con responsabilidades distintas:

## Estructura de las tres carpetas

### `context_LAIA/` — Visión y diseño del proyecto (estás aquí)

Contiene la visión, el propósito, roadmap, versionamiento y diseño de producto. Punto de partida para entender qué es LAIA y hacia dónde va.

- `02-proyecto-laia.md` — Qué es LAIA, los tres agentes, modos de instalación y filosofía técnica
- `03-roadmap.md` — Plan de evolución, fases y estado actual del proyecto
- `04-guia-versionamiento.md` — Guía práctica de versionamiento semántico A/B con ejemplos
- `05-versionamiento.md` — Especificación técnica del sistema de versiones (archivos, scripts, bloques)
- `agora-arquitectura.md` — Diseño de Laia Agora como producto empresarial (arquitectura Bloque B)

### `context_Code/` — Estado del código y protocolo para IAs

Contiene el estado real del código, la arquitectura interna y las reglas de trabajo para los agentes. Cualquier IA debe leer esto antes de tocar código.

- `00-como-trabajan-las-ias.md` — **Entrada obligatoria para IAs.** Protocolo completo: qué leer, reglas, coordinación multi-agente, lo que está permitido y lo que no, versionamiento y criterios de entrega
- `01-estado-actual.md` — Qué está implementado de verdad hoy en el repo
- `06-como-funciona-por-dentro.md` — Arquitectura interna detallada: fases, archivos, flujo de datos
- `sesion-activa.md` — Log de la sesión de trabajo activa y tabla de archivos reservados

### `context_Guias/` — Guías para el administrador humano

Contiene documentación pensada para el administrador del proyecto. No es relevante para las IAs.

- `07-guia-programacion-para-entender-laia.md` — Conceptos técnicos explicados de forma accesible
- `08-guia-git-github.md` — Git, GitHub y commits en el repo
- `09-comandos-laia-arch.md` — Comandos de build, test, instalación y versiones

## Principio editorial

Esta documentación distingue siempre entre:

1. Lo que ya existe de verdad en el repo
2. Lo que está parcialmente construido
3. Lo que sigue siendo visión o diseño futuro

Fecha base de esta versión: `2026-03-26`.
Última revisión estructural: `2026-03-30`.
