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

# Instrucciones para IAs — Versionamiento de Laia Arch

Esta guía es **para agentes de IA que hacen cambios en el código**. Explica exactamente cómo actualizar la versión después de completar una tarea.

## Paso 1: Identificar qué archivos modificaste

Después de hacer tus cambios y antes de commit, ejecuta:

```bash
git diff --name-only HEAD
```

Este comando lista exactamente qué archivos cambiaste.

**Ejemplos:**

- `src/installer/bootstrap.ts` → Afecta **Block A**
- `src/installer/tools/ldap-tools.ts` → Afecta **Block A**
- `src/agora/workspace.ts` → Afecta **Block B**
- `docs/channels/README.md` → **No afecta** versión
- `context_LAIA/README.md` → **No afecta** versión

## Paso 2: Determinar qué bloque(s) afectaste

### Bloque A — `src/installer/**` y relacionados

Afectado si modificaste:

- `src/installer/**/*.ts` (cualquier archivo en installer)
- `src/cli/laia-arch-theme.ts` (UI del instalador)
- `scripts/detect-version-increment.ts` (herramientas del instalador)
- `scripts/update-version.ts` (herramientas del instalador)

### Bloque B — `src/agora/**`, `src/nemo/**`, etc.

Afectado si modificaste:

- `src/agora/**/*.ts` (Agora app)
- `src/nemo/**/*.ts` (Nemo app)
- `src/provider-web.ts` (UI web del ecosistema)
- `apps/macos/**/*.swift` (UI macOS del ecosistema)

### NO afectan versión

No cambies versión si modificaste:

- `docs/**/*.md` (documentación)
- `context_LAIA/**/*.md` (documentación interna)
- `context_Code/**/*.md` (documentación interna)
- `*.test.ts` (tests)
- `.github/**` (CI/CD)
- `oxlint.json`, `.eslintrc`, etc. (configuración)

## Paso 3: Determinar el tipo de bump

Ejecuta el detector automático:

```bash
node --import tsx scripts/detect-version-increment.ts --since-commits 1
```

Este script **analiza automáticamente los cambios y te sugiere** qué version poner.
Ahora lo hace leyendo la versión actual desde `version.manifest.json`, separando:

- archivos que afectan al bloque `A`
- archivos que afectan al bloque `B`
- archivos que **no deben** cambiar versión (`docs`, `context_`, tests, `.github`, etc.)
- archivos fuera de bloque, para que la IA sepa que hubo cambios pero no los use como bump automático

**Ejemplo de output:**

```
📝 Block A changes detected (3 files):
   - src/installer/bootstrap.ts
   - src/installer/conversation.ts
   - src/installer/credential-manager.ts

Suggestion: A:2.2.0 → A:2.3.0 (minor)
Confidence: HIGH
Reason: New OAuth flow changes (961 additions)
```

### Si el detector sugiere "HIGH" o "MEDIUM"

**Confía en la sugerencia.** El script sabe bien qué tipo de cambio es.

### Si el detector dice que no hace falta bump

No cambies `version.manifest.json`.

El detector devuelve "no version increment needed" cuando todos los cambios están en documentación, contexto, tests o ficheros que no forman parte de los bloques versionados.

### Si tienes duda

Usa esta tabla de decisión rápida:

| Tipo de cambio                                   | Bump    |
| ------------------------------------------------ | ------- |
| Bug fix (una función rota)                       | `patch` |
| Mejora interna (refactor)                        | `patch` |
| Nueva capacidad (nueva herramienta, API)         | `minor` |
| Cambio de arquitectura (nuevo motor, nueva fase) | `major` |

**Ejemplos prácticos:**

| Cambio               | Decisión | Comando                  |
| -------------------- | -------- | ------------------------ |
| Fix en PKCE de OAuth | patch    | `--block A --bump patch` |
| Nuevo provider de IA | minor    | `--block A --bump minor` |
| Nuevo canal de Nemo  | minor    | `--block B --bump minor` |
| Rewrite del executor | major    | `--block A --bump major` |

## Paso 4: Aplicar el bump

Una vez decidido el tipo, ejecuta exactamente uno de estos comandos:

### Para Block A (instalador)

```bash
# Si es un bug fix o mejora interna
node --import tsx scripts/update-version.ts --block A --bump patch

# Si es una nueva capacidad
node --import tsx scripts/update-version.ts --block A --bump minor

# Si es cambio de arquitectura
node --import tsx scripts/update-version.ts --block A --bump major
```

### Para Block B (ecosistema)

```bash
# Si es un bug fix
node --import tsx scripts/update-version.ts --block B --bump patch

# Si es nueva funcionalidad
node --import tsx scripts/update-version.ts --block B --bump minor

# Si es cambio fundamental
node --import tsx scripts/update-version.ts --block B --bump major
```

### Si afectaste AMBOS bloques

Ejecuta ambos comandos (uno para A, uno para B):

```bash
node --import tsx scripts/update-version.ts --block A --bump minor
node --import tsx scripts/update-version.ts --block B --bump patch
```

## Paso 5: Verificar que aplicó correctamente

Después de ejecutar el comando update-version, verifica:

```bash
# Ver la versión actual
cat version.manifest.json | jq '.blocks.A, .compilationDate'
```

Output esperado:

```json
{
  "major": 2,
  "minor": 3,
  "patch": 0,
  ...
}
"2026.3.29"
```

**Confirmación:** Si el número `.minor` o `.patch` cambió, ¡funcionó!

## Paso 6: Incluir en el commit

Ahora que la versión está actualizada, agrégala al commit:

```bash
git add version.manifest.json
git commit -m "Update version: A:2.2 → A:2.3 (add OAuth Codex support)"
```

O si el commit ya existe pero sin version.manifest.json:

```bash
git add version.manifest.json
git commit --amend --no-edit
# O crear un nuevo commit si el anterior ya fue pushed
```

## Flujo completo de ejemplo

### Escenario: "Agregué soporte para Codex OAuth"

```bash
# 1. Ver qué cambié
$ git diff --name-only HEAD
src/installer/bootstrap.ts
src/installer/conversation.ts
src/installer/credential-manager.ts

# 2. Detectar tipo de bump
$ node --import tsx scripts/detect-version-increment.ts --since-commits 1
Block A changes detected (3 files)
Suggestion: A:2.2.0 → A:2.3.0 (minor)
Confidence: HIGH
Reason: New OAuth flow changes

# 3. Aplicar el bump (siguiendo la sugerencia)
$ node --import tsx scripts/update-version.ts --block A --bump minor
✅ Version updated:
   Block A: 2.2.0 → 2.3.0 (minor)
   Compilation date: 2026.3.29

# 4. Verificar
$ cat version.manifest.json | jq '.blocks.A.minor'
3

# 5. Commit con la versión
$ git add version.manifest.json
$ git commit -m "Add OAuth Codex support — bump to A:2.3"
```

## Notas importantes para IAs

### ⚠️ Solo actualiza si hay cambios significativos

Si solo editaste comentarios, docstrings, o tests dentro de archivos del instalador:
→ Probablemente NO necesites bump. Verifica con `detect-version-increment.ts`.

### ⚠️ La IA decide por capacidad, no por intuición

Usa esta regla práctica:

- si arreglaste algo existente sin cambiar capacidades → `patch`
- si añadiste una herramienta, integración o capacidad nueva → `minor`
- si cambiaste la arquitectura o el flujo base del bloque → `major`
- si solo tocaste docs/tests/contexto → **sin bump**

### ⚠️ El detector es tu mejor amigo

Si tienes duda, **SIEMPRE** corre:

```bash
node --import tsx scripts/detect-version-increment.ts --since-commits 1
```

Confía en su sugerencia de "confidence" (HIGH/MEDIUM/LOW).

### ⚠️ Si te equivocas

No es un problema. Simplemente edita manualmente `version.manifest.json`:

```json
{
  "blocks": {
    "A": {
      "major": 2,
      "minor": 3,   ← Cambiar aquí si te equivocaste
      "patch": 0
    }
  }
}
```

Luego:

```bash
git add version.manifest.json
git commit -m "Fix version number"
```

### ⚠️ Cuándo NO actualizar versión

```bash
git diff --name-only HEAD | grep -E "(\.test\.ts|docs/|context_|\.github|oxlint|eslint)"
```

Si TODOS los archivos cambiados están en esas categorías → **NO actualices versión.**

### ⚠️ Modo máquina para otras IAs

Si otra IA necesita tomar la decisión sin parsear texto humano, usa:

```bash
node --import tsx scripts/detect-version-increment.ts --since-commits 1 --json
```

Ese modo devuelve:

- `suggestions`: bumps recomendados por bloque
- `ignored`: archivos sin impacto de versión
- `uncategorized`: archivos fuera de A/B

## Checklist antes de hacer push

- [ ] Ejecuté `detect-version-increment.ts --since-commits 1`
- [ ] Decidí si era patch/minor/major
- [ ] Ejecuté `update-version.ts --block X --bump TYPE`
- [ ] Verifiqué con `cat version.manifest.json | jq`
- [ ] Version.manifest.json está en el commit
- [ ] El commit message menciona la versión (ej: "bump to A:2.3")

## Referencia rápida

```bash
# VER cambios desde último commit
git diff --name-only HEAD

# DETECTAR qué versión poner
node --import tsx scripts/detect-version-increment.ts --since-commits 1

# APLICAR patch (2.2.0 → 2.2.1)
node --import tsx scripts/update-version.ts --block A --bump patch

# APLICAR minor (2.2.0 → 2.3.0)
node --import tsx scripts/update-version.ts --block A --bump minor

# APLICAR major (2.2.0 → 3.0.0)
node --import tsx scripts/update-version.ts --block A --bump major

# VERIFICAR que cambió
cat version.manifest.json | jq '.blocks.A'

# INCLUIR en commit
git add version.manifest.json
git commit -m "Descripción del cambio — bump to A:2.3"
```
