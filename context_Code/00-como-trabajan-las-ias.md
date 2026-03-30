# Cómo deben trabajar las IAs en el proyecto LAIA

> Entrada obligatoria para cualquier IA (Claude, Codex, Antigravity, etc.) que trabaje en este proyecto.
> Lee esto **antes** de tocar cualquier archivo.

---

## 1. Lee el contexto antes de actuar

Leer en este orden:

1. `context_LAIA/02-proyecto-laia.md` — qué es LAIA y hacia dónde va
2. `context_LAIA/03-roadmap.md` — en qué fase estamos y qué es prioritario ahora mismo
3. `context_Code/01-estado-actual.md` — qué está implementado de verdad en el repo
4. `context_Code/sesion-activa.md` — qué está pasando en esta sesión de trabajo

Si no lees estos cuatro archivos primero, vas a tomar decisiones con contexto incompleto
y probablemente construirás algo que no encaja con el proyecto.

---

## 2. Tres preguntas antes de escribir una sola línea

**¿Esto ya existe?**
Busca en el repo. Muchas cosas que parecen pendientes ya están implementadas.
`01-estado-actual.md` es tu referencia. Si no lo has leído, no puedes responder.

**¿Corresponde al trabajo activo ahora mismo?**
El proyecto tiene un Bloque A (el instalador, trabajo activo) y un Bloque B (el ecosistema
post-instalación, trabajo futuro). Si tu tarea pertenece al Bloque B y el Bloque A no está
cerrado, para y avisa. No implementes trabajo futuro antes de tiempo.

**¿Entiendo el impacto de este cambio?**
Si un cambio afecta `src/installer/types.ts`, afecta a todos los módulos que consumen esos tipos.
Si afecta al executor, afecta a la ejecución completa. Entiende el alcance antes de actuar.

---

## 3. Durante el trabajo

- Cambia una capa cada vez. No refactorices y añadas features en el mismo paso.
- Si encuentras algo roto que no es tu tarea, anótalo pero no lo toques.
  Documéntalo en `01-estado-actual.md` bajo una nota de hallazgo.
- Si necesitas cambiar `src/installer/types.ts`, sé consciente de que estás cambiando el
  contrato compartido de todo el sistema. Hazlo con cuidado y documenta el porqué.

---

## 4. Protocolo de reserva de archivos (trabajo multi-agente)

Cuando haya más de un agente trabajando, usar `sesion-activa.md` para coordinarse.

### Al empezar

```
- [HH:MM] <Agente>: archivos reservados: archivo1.ts, archivo2.ts
```

### Al terminar

```
- [HH:MM] <Agente>: archivos liberados. Tests: X/X verde.
```

El primer agente que arranque una sesión multi-agente crea `sesion-activa.md` con esta estructura:

```markdown
# Sesión de trabajo activa

Fecha: [fecha]
Agentes: [lista de agentes trabajando]

## Archivos en uso

| Archivo           | Agente | Estado |
| ----------------- | ------ | ------ |
| (vacío al inicio) |        |        |

## Log de cambios de esta sesión

(vacío al inicio)
```

---

## 5. Qué está permitido y qué no

### Siempre permitido

- Leer cualquier archivo del repo.
- Modificar archivos dentro del alcance de tu tarea.
- Añadir tests para código que estás tocando.
- Actualizar `01-estado-actual.md` y `03-roadmap.md` para reflejar cambios reales.
- Anotar hallazgos de problemas que no son tu tarea.

### Permitido con cuidado

- `src/installer/types.ts` — contrato compartido. Documenta por qué y qué cambia.
- `src/installer/plan-generator.ts` — fallback seguro del sistema. Solo modificaciones quirúrgicas.
- Refactorizar archivos grandes — en un commit separado, sin mezclar con cambios funcionales.

### Nunca permitido

- Describir como implementado algo que solo está en la visión.
- Empezar trabajo del Bloque B (UI de Arch, Agora como producto, Nemo, bus inter-agente, métricas)
  antes de que el Bloque A esté cerrado.
- Eliminar `plan-generator.ts` o dejarlo inoperativo — es el fallback de seguridad.
- Marcar un paso de instalación como completado solo porque el comando devolvió `exit 0`
  sin verificación real del estado del servicio.
- Proponer una reescritura completa cuando puede hacerse una migración incremental.
- Dejar código en estado que no coincide con la documentación sin actualizarla.
- En trabajo multi-agente: modificar un archivo marcado como "editando" por otro agente.
- `git stash`, `git worktree`, ni cambiar de rama sin que se te pida explícitamente.

---

## 6. Cómo tratar los archivos de contexto

| Archivo                                                    | Cuándo actualizarlo                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| `context_Code/01-estado-actual.md`                         | Siempre que termines una sesión de trabajo                      |
| `context_LAIA/02-proyecto-laia.md`                         | Solo si cambia la visión del producto (decisión del arquitecto) |
| `context_LAIA/03-roadmap.md`                               | Cuando una fase avanza, se cierra o cambian las prioridades     |
| `context_Code/00-como-trabajan-las-ias.md`                 | Solo si cambian las reglas de trabajo (decisión del arquitecto) |
| `context_Code/06-como-funciona-por-dentro.md`              | Cuando cambie la arquitectura interna del código                |
| `context_Guias/07-guia-programacion-para-entender-laia.md` | Raramente — solo si cambia el stack                             |

Los archivos `02`, `06` y `07` los modifica principalmente el arquitecto del proyecto.
Si crees que algo en ellos está mal, anótalo como hallazgo en tu entrega pero no los edites directamente.

---

## 7. Si encuentras contradicciones documentación-código

Si el código hace algo distinto a lo que dice la documentación:

1. No asumas que el documento está mal.
2. No asumas que el código está mal.
3. Analiza cuál de los dos refleja la intención correcta.
4. Actualiza el que esté desactualizado.
5. Deja una nota en el log explicando la discrepancia que encontraste.

---

## 8. Build y tests antes de entregar

- Si tocas código del instalador: `pnpm test -- src/installer/`
- Si tocas cualquier otro código: `pnpm check`
- Si el cambio puede afectar el build: `pnpm build:laia-arch`

---

## 9. Versionamiento

Cuando hagas cambios significativos en `src/installer/**` (Bloque A) o `src/agora/**` (Bloque B):

```bash
# Detectar qué versión corresponde
node --import tsx scripts/detect-version-increment.ts --since-commits 1

# Aplicar el bump sugerido
node --import tsx scripts/update-version.ts --block A --bump minor
```

Guía completa: `context_LAIA/04-guia-versionamiento.md`
Especificación técnica: `context_LAIA/05-versionamiento.md`

---

## 10. Cuándo está terminado tu trabajo

Tu trabajo no está terminado hasta que:

- El código hace lo que se pedía.
- Los tests relevantes pasan.
- `01-estado-actual.md` refleja los cambios que hiciste.
- Si avanzaste en el roadmap, `03-roadmap.md` está actualizado.
- Si trabajabas en grupo, `sesion-activa.md` tiene tu log.
- No dejaste ningún archivo en un estado inconsistente.

**Entrega incompleta = documentación sin actualizar.**

---

## 11. Resumen de carpetas

| Carpeta          | Qué contiene                                                                    |
| ---------------- | ------------------------------------------------------------------------------- |
| `context_LAIA/`  | Visión del proyecto, roadmap, guías de versionamiento. Lee esto primero.        |
| `context_Code/`  | Estado del código, sesiones activas, arquitectura interna. Lee antes de codear. |
| `context_Guias/` | Guías para el administrador humano. No relevante para IAs.                      |

---

## 12. Frase guía

Cuando no sepas qué hacer, vuelve a esta pregunta:

**¿Esto acerca de verdad a Laia Arch al rol de agente instalador experto,
o me estoy desviando?**

Si la respuesta es "me estoy desviando", para y relee el roadmap.
