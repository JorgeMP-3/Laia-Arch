# Cómo deben trabajar las IAs en el proyecto LAIA

> Este archivo es la entrada obligatoria para cualquier IA (Claude, Codex, Antigravity, etc.)
> que trabaje en este proyecto. Léelo antes de tocar cualquier código.

## Regla 1: Lee el contexto antes de actuar

Antes de escribir una sola línea de código, lee en este orden:

1. `context_LAIA/02-proyecto-laia.md` — Qué es LAIA y para qué existe
2. `context_LAIA/03-roadmap.md` — En qué fase estamos y qué es prioritario
3. `context_Code/01-estado-actual.md` — Qué está implementado de verdad
4. `context_Code/sesion-activa.md` — Qué se está haciendo ahora mismo

## Regla 2: No abras frentes nuevos

El roadmap define el orden. Si la tarea que te piden no está en la fase activa, di que no es el momento.
No implementes features del Bloque B mientras el Bloque A no esté cerrado.

## Regla 3: Verifica antes de afirmar

Si vas a decir "X está implementado", búscalo en el código.
Si vas a decir "X no existe", búscalo también.
Una afirmación sin verificar en el código es peor que no saber.

## Regla 4: Documenta lo que cambias

Cuando termines una tarea:

- Actualiza `context_Code/01-estado-actual.md` si cambia lo que está implementado
- Actualiza `context_LAIA/03-roadmap.md` si una fase avanza o se cierra
- Añade una entrada en `context_Code/sesion-activa.md` con qué hiciste

## Regla 5: Seguridad del multi-agente

Varios agentes pueden estar trabajando al mismo tiempo.

- Antes de editar un archivo, comprueba si otro agente lo tiene reservado en `sesion-activa.md`
- No hagas `git stash`, `git worktree`, ni cambies de rama sin que se te pida explícitamente
- Haz commits pequeños y atómicos, uno por tarea

## Regla 6: Build y tests antes de entregar

- Si tocas código del instalador: `pnpm test -- src/installer/`
- Si tocas cualquier otro código: `pnpm check`
- Si el cambio puede afectar el build: `pnpm build:laia-arch`

## Protocolo de reserva de archivos

Cuando empieces a trabajar, anota en `sesion-activa.md`:

```
- [HH:MM] <Agente>: archivos reservados: archivo1.ts, archivo2.ts
```

Cuando termines, marca los archivos como libres:

```
- [HH:MM] <Agente>: archivos liberados. Tests: X/X verde.
```

## Resumen de carpetas

| Carpeta          | Qué contiene                                                          |
| ---------------- | --------------------------------------------------------------------- |
| `context_LAIA/`  | Visión del proyecto, roadmap. Lee esto primero.                       |
| `context_Code/`  | Estado del código, sesiones, arquitectura. Lee antes de tocar código. |
| `context_Guias/` | Guías para el administrador humano. No relevante para IAs.            |
