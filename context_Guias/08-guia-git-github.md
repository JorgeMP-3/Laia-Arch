# Guía práctica: Git y GitHub

Esta guía cubre todo lo que necesitas para gestionar el código del proyecto con Git y GitHub.

---

## Índice

1. [Conceptos básicos](#1-conceptos-básicos)
2. [Configuración inicial (una sola vez)](#2-configuración-inicial-una-sola-vez)
3. [Flujo de trabajo diario](#3-flujo-de-trabajo-diario)
4. [Sincronizar con GitHub](#4-sincronizar-con-github)
5. [Situaciones de emergencia](#5-situaciones-de-emergencia)
6. [Referencia rápida](#6-referencia-rápida)

---

## 1. Conceptos básicos

### ¿Qué es Git?

Git es un sistema que guarda el historial de todos los cambios que haces en el código.
Cada vez que "guardas" con Git, se crea un punto de restauración llamado **commit**.

```
Tu máquina (local)                GitHub (remoto)
─────────────────────             ──────────────────────
código actual                     copia del código
historial de commits    ←→        historial de commits
rama: main                        rama: main
```

### Los tres estados de un archivo en Git

```
1. MODIFICADO   →  has cambiado el archivo pero Git no sabe todavía
2. STAGED       →  le has dicho a Git "incluye este en el próximo commit"
3. COMMITTED    →  el cambio está guardado en el historial local
```

### ¿Qué es una rama (branch)?

Una rama es una línea de desarrollo independiente. Por defecto trabajas en `main`.
Si quieres probar algo sin romper lo que funciona, creas una rama nueva.

```
main:       A → B → C → D        (lo que está en GitHub, siempre estable)
mi-rama:              ↳ E → F    (donde experimentas)
```

---

## 2. Configuración inicial (una sola vez)

### Identificarte en Git

```bash
git config --global user.name "Tu Nombre"
git config --global user.email "tu@email.com"
```

### Configurar SSH para GitHub (recomendado — no pide contraseña cada vez)

```bash
# 1. Generar clave SSH
ssh-keygen -t ed25519 -C "tu@email.com"
# Pulsa Enter en todo (sin contraseña es más cómodo en servidor)

# 2. Ver tu clave pública
cat ~/.ssh/id_ed25519.pub
# Copia todo el texto que aparece

# 3. Añadirla en GitHub:
#    GitHub → tu foto de perfil → Settings → SSH and GPG keys
#    → New SSH key → pega el texto → Save

# 4. Verificar que funciona
ssh -T git@github.com
# Debe responder: "Hi JorgeMP-3! You've successfully authenticated..."

# 5. Asegúrate de que tu repo usa SSH (no HTTPS)
git remote set-url origin git@github.com:JorgeMP-3/Laia-Arch.git
git remote -v   # debe mostrar git@github.com:...
```

---

## 3. Flujo de trabajo diario

### Ver en qué estado está todo

```bash
git status          # qué archivos han cambiado
git log --oneline   # últimos commits (pulsa q para salir)
git diff            # ver exactamente qué líneas cambiaron
```

### Guardar cambios (commit)

```bash
# 1. Ver qué has cambiado
git status

# 2. Añadir archivos concretos al staging
git add src/installer/index.ts

# O añadir todos los cambios de una vez
git add .

# 3. Crear el commit
git commit -m "fix: corregir timeout del gateway provisional"

# En este proyecto hay un script especial que hace add + commit + verifica formato:
bash scripts/committer "fix: corregir timeout" src/installer/index.ts
```

### Cómo escribir buenos mensajes de commit

```
fix:      algo que se rompía y ya no
feat:     nueva funcionalidad añadida
chore:    cambio sin impacto en el usuario (versión, limpieza)
docs:     solo documentación
refactor: mismo comportamiento, código reorganizado

Ejemplos:
  fix: resolver error 403 al llamar al endpoint Codex
  feat: añadir modo silencioso al gateway provisional
  docs: actualizar guía de instalación
```

### Ver el historial

```bash
git log --oneline -10          # últimos 10 commits resumidos
git log --oneline --graph      # árbol visual de ramas
git show abc1234               # ver qué cambió en un commit concreto
```

---

## 4. Sincronizar con GitHub

### Subir tus commits (push)

```bash
# Primero integra los cambios remotos para evitar conflictos
git pull --rebase origin main

# Luego sube
git push origin main
```

**Regla de oro:** siempre haz `git pull --rebase` antes de `git push`.

### Descargar cambios sin aplicarlos todavía (fetch)

```bash
git fetch origin               # descarga pero no toca nada
git log origin/main --oneline  # ver qué hay en el remoto
```

### Descargar y aplicar cambios (pull)

```bash
git pull --rebase origin main
# --rebase pone TUS commits encima de los cambios remotos
# (más limpio que el merge por defecto)
```

### Clonar el repo desde cero en otra máquina

```bash
git clone git@github.com:JorgeMP-3/Laia-Arch.git
cd Laia-Arch
```

---

## 5. Situaciones de emergencia

### "Hice cambios y quiero descartarlos"

```bash
# Descartar cambios en UN archivo (vuelve al último commit)
git restore src/installer/index.ts

# Descartar TODOS los cambios sin commitear
git restore .
# CUIDADO: esto es irreversible
```

### "Hice un commit mal y quiero deshacerlo"

```bash
# Deshacer el último commit pero CONSERVAR los archivos tal como están
git reset --soft HEAD~1

# Deshacer el último commit Y borrar los cambios (peligroso)
git reset --hard HEAD~1
# CUIDADO: pierdes los cambios para siempre
```

### "Hay un conflicto al hacer pull --rebase"

Esto pasa cuando tú y el remoto habéis cambiado la misma línea.

```bash
git pull --rebase origin main
# Git pausa y dice: CONFLICT en archivo X

# 1. Abre el archivo conflictivo, verás algo así:
#    <<<<<<< HEAD
#    tu versión de la línea
#    =======
#    la versión del remoto
#    >>>>>>> abc1234

# 2. Edita el archivo y deja solo lo que quieres (borra las marcas <<<<< ===== >>>>>)
# 3. Marca el conflicto como resuelto
git add archivo-conflictivo.ts

# 4. Continúa el rebase
git rebase --continue

# Si te has liado y quieres cancelar todo
git rebase --abort
```

### "Quiero ver cómo estaba un archivo antes"

```bash
git log --oneline src/installer/index.ts    # historial del archivo
git show abc1234:src/installer/index.ts     # ver el archivo en ese commit
```

### "El push me da error de fast-forward"

```bash
# Significa que el remoto tiene commits que tú no tienes. Solución:
git pull --rebase origin main
git push origin main
```

---

## 6. Referencia rápida

| Qué quieres hacer            | Comando                                            |
| ---------------------------- | -------------------------------------------------- |
| Ver estado actual            | `git status`                                       |
| Ver cambios en detalle       | `git diff`                                         |
| Ver historial                | `git log --oneline -10`                            |
| Añadir archivo al staging    | `git add ruta/archivo.ts`                          |
| Añadir todo al staging       | `git add .`                                        |
| Crear commit                 | `git commit -m "mensaje"`                          |
| Subir a GitHub               | `git pull --rebase && git push`                    |
| Descargar cambios            | `git pull --rebase origin main`                    |
| Descartar cambios en archivo | `git restore archivo.ts`                           |
| Deshacer último commit       | `git reset --soft HEAD~1`                          |
| Ver ramas                    | `git branch -a`                                    |
| Clonar el repo               | `git clone git@github.com:JorgeMP-3/Laia-Arch.git` |

---

_Última actualización: 2026-03-28_
