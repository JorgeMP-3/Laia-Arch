# LAIA — Protocolo de comportamiento para agentes de código

> Este documento lo debe leer cualquier IA que trabaje en el proyecto LAIA,
> independientemente de la tarea concreta que tenga asignada.
> Define cómo comportarse, qué hacer antes de tocar código, qué hacer al terminar,
> y cómo coordinarse con otros agentes si los hay.

---

## 1. Antes de hacer cualquier cosa

Leer en este orden:

1. `contextLaiaProyect/02-proyecto-laia.md` — qué es LAIA y hacia dónde va
2. `contextLaiaProyect/01-estado-actual.md` — qué existe hoy de verdad en el repo
3. `contextLaiaProyect/03-roadmap.md` — qué hay que hacer y en qué orden
4. `contextLaiaProyect/06-como-funciona-por-dentro.md` — cómo está organizado el código

Si no lees estos cuatro archivos primero, vas a tomar decisiones con contexto incompleto
y probablemente vas a construir algo que no encaja con el proyecto.

No hay excepción a esta regla.

---

## 2. Tres preguntas que debes responder antes de escribir una sola línea

Antes de tocar cualquier archivo, respóndete estas tres preguntas:

**¿Esto ya existe?**
Busca en el repo. Muchas cosas que parecen pendientes ya están implementadas.
`01-estado-actual.md` es tu referencia. Si no lo has leído, no puedes responder esta pregunta.

**¿Esto corresponde al trabajo activo ahora mismo?**
El proyecto tiene un Bloque A (el instalador, trabajo activo) y un Bloque B (el ecosistema
post-instalación, trabajo futuro). Si la tarea que tienes pertenece al Bloque B y el
Bloque A no está cerrado, para y avisa. No implementes trabajo futuro antes de tiempo.

**¿Entiendo el impacto de este cambio?**
Si un cambio afecta a `src/installer/types.ts`, afecta a todos los módulos que consumen
esos tipos. Si afecta al executor, afecta a la ejecución completa. Entiende el alcance
antes de actuar.

---

## 3. Reglas de trabajo en solitario

Cuando trabajas solo en una tarea:

### Al empezar

- Lee los cuatro documentos de contexto.
- Identifica exactamente qué archivo o archivos vas a tocar.
- Verifica que esos archivos están dentro del alcance de tu tarea.

### Durante el trabajo

- Cambia una capa cada vez. No refactorices y añadas features en el mismo paso.
- Si encuentras algo roto que no es tu tarea, anótalo pero no lo toques.
  Documéntalo al final en `01-estado-actual.md` bajo una nota de hallazgo.
- Si necesitas cambiar `src/installer/types.ts`, sé consciente de que estás
  cambiando el contrato compartido de todo el sistema. Hazlo con cuidado.

### Al terminar

**Obligatorio después de cada sesión de trabajo:**

Actualiza `contextLaiaProyect/01-estado-actual.md` con lo que cambió.
Si cerraste algo que estaba pendiente, muévelo a "implementado".
Si encontraste algo nuevo que falta, añádelo.
Si avanzaste en una fase del roadmap, actualiza también `contextLaiaProyect/03-roadmap.md`.

La documentación desactualizada es tan peligrosa como el código roto.
Otro agente que llegue después va a tomar decisiones basadas en lo que diga ese archivo.

---

## 4. Reglas de trabajo en grupo

Cuando el prompt indica que hay más de un agente trabajando en el proyecto
(palabras clave: "trabajo en grupo", "trabajad juntos", "coordinaros", o si ves
que otro agente ya ha modificado archivos recientemente):

### Paso 1 — Crear o localizar el archivo de coordinación

Al inicio del trabajo en grupo debe existir un archivo:

```
contextLaiaProyect/sesion-activa.md
```

Si no existe, el primer agente que empiece lo crea con esta estructura:

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

### Paso 2 — Registrar qué vas a tocar antes de tocarlo

Antes de modificar cualquier archivo, añade una fila a la tabla "Archivos en uso":

```markdown
| src/installer/executor.ts | Claude Code | editando |
```

Esto evita que dos agentes modifiquen el mismo archivo a la vez.

### Paso 3 — Actualizar el log al terminar cada cambio

Cada vez que termines una modificación, añade una entrada al log:

```markdown
- [hora] Claude Code: refactorizó executor.ts para unificar historial de rescate.
  Cambio en tipos: ninguno. Tests: executor.test.ts pasa.
```

### Paso 4 — Liberar el archivo cuando termines

Cuando termines con un archivo, cambia su estado en la tabla:

```markdown
| src/installer/executor.ts | Claude Code | libre |
```

### Paso 5 — Al terminar la sesión completa

Cuando todos los agentes hayan terminado:

- Mover el contenido relevante del log al changelog de `03-roadmap.md`.
- Actualizar `01-estado-actual.md` con todo lo que cambió.
- Eliminar o archivar `sesion-activa.md`.

---

## 5. Qué está permitido y qué no

### Siempre permitido

- Leer cualquier archivo del repo.
- Modificar archivos dentro del alcance de tu tarea.
- Añadir tests para código que estás tocando.
- Actualizar `01-estado-actual.md` y `03-roadmap.md` para reflejar cambios reales.
- Anotar hallazgos de problemas que no son tu tarea.

### Permitido con cuidado

- Modificar `src/installer/types.ts` — es el contrato compartido. Cualquier cambio
  aquí afecta a todos los módulos. Documenta por qué y qué cambia.
- Modificar `src/installer/plan-generator.ts` — es el fallback seguro del sistema.
  No eliminarlo. No reescribirlo entero. Solo modificaciones quirúrgicas.
- Refactorizar archivos grandes — hazlo en un commit separado, sin mezclar con
  cambios funcionales.

### Nunca permitido

- Describir como implementado algo que solo está en la visión.
- Empezar trabajo del Bloque B (UI de Arch, Agora como producto, Nemo, bus
  inter-agente, métricas) antes de que el Bloque A esté cerrado.
- Eliminar `plan-generator.ts` o dejarlo inoperativo — es el fallback de seguridad.
- Marcar un paso de instalación como completado solo porque el comando devolvió
  exit 0 sin verificación real del estado del servicio.
- Proponer o implementar una reescritura completa del sistema cuando puede
  hacerse una migración incremental.
- Dejar el código en un estado que no coincide con la documentación sin actualizarla.
- En trabajo en grupo: modificar un archivo marcado como "editando" por otro agente.

---

## 6. Cómo tratar los archivos de contexto

La carpeta `contextLaiaProyect/` es la memoria del proyecto.

| Archivo                                      | Cuándo actualizarlo                                             |
| -------------------------------------------- | --------------------------------------------------------------- |
| `01-estado-actual.md`                        | Siempre que termines una sesión de trabajo                      |
| `02-proyecto-laia.md`                        | Solo si cambia la visión del producto (decisión del arquitecto) |
| `03-roadmap.md`                              | Cuando una fase avanza, se cierra, o cambian las prioridades    |
| `04-agentes-de-codigo.md`                    | Solo si cambian las reglas de trabajo (decisión del arquitecto) |
| `06-como-funciona-por-dentro.md`             | Cuando cambie la arquitectura interna del código                |
| `07-guia-programacion-para-entender-laia.md` | Raramente — solo si cambia el stack                             |

Los archivos `02`, `04` y `07` los modifica principalmente el arquitecto del proyecto,
no los agentes de código. Si crees que algo en ellos está mal, anótalo como hallazgo
en tu entrega pero no los edites directamente.

---

## 7. Qué hacer si encuentras algo que contradice la documentación

Si el código hace algo distinto a lo que dice la documentación, o si el estado
real del repo no coincide con `01-estado-actual.md`:

1. No asumas que el documento está mal.
2. No asumas que el código está mal.
3. Analiza cuál de los dos refleja la intención correcta.
4. Actualiza el que esté desactualizado.
5. Deja una nota en el log o en el changelog explicando qué discrepancia encontraste.

---

## 8. Criterios para saber si tu trabajo está terminado

Tu trabajo en una tarea no está terminado hasta que:

- El código hace lo que se pedía.
- Los tests relevantes pasan.
- `01-estado-actual.md` refleja los cambios que hiciste.
- Si avanzaste en el roadmap, `03-roadmap.md` está actualizado.
- Si trabajabas en grupo, `sesion-activa.md` está actualizado con tu log.
- No dejaste ningún archivo en un estado inconsistente.

Entrega incompleta = documentación sin actualizar.

---

## 9. Frase guía

Cuando no sepas qué hacer, vuelve a esta pregunta:

**¿Esto acerca de verdad a Laia Arch al rol de agente instalador experto,
o me estoy desviando?**

Si la respuesta es "me estoy desviando", para y relee el roadmap.
