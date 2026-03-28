# Guía práctica: Git, GitHub y comandos de Laia Arch

Esta guía está pensada para que puedas trabajar con el proyecto sin depender de memoria.
Todo lo que necesitas está aquí.

---

## Índice

1. [Conceptos básicos que debes entender](#1-conceptos-básicos-que-debes-entender)
2. [Configuración inicial (una sola vez)](#2-configuración-inicial-una-sola-vez)
3. [Flujo de trabajo diario con Git](#3-flujo-de-trabajo-diario-con-git)
4. [Sincronizar con GitHub](#4-sincronizar-con-github)
5. [Situaciones de emergencia](#5-situaciones-de-emergencia)
6. [Compilar e instalar Laia Arch](#6-compilar-e-instalar-laia-arch)
7. [Referencia rápida de comandos](#7-referencia-rápida-de-comandos)

---

## 1. Conceptos básicos que debes entender

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
1. MODIFICADO     →  has cambiado el archivo pero Git no sabe todavía
2. STAGED         →  le has dicho a Git "incluye este archivo en el próximo commit"
3. COMMITTED      →  el cambio está guardado en el historial local
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

### Configurar SSH para GitHub (recomendado, no pide contraseña cada vez)

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

## 3. Flujo de trabajo diario con Git

### Ver en qué estado está todo

```bash
git status          # qué archivos han cambiado
git log --oneline   # últimos commits (q para salir)
git diff            # ver exactamente qué líneas cambiaron
```

### Guardar cambios (commit)

```bash
# Ver qué has cambiado
git status

# Añadir archivos concretos al staging
git add src/installer/index.ts
git add src/installer/conversation.ts

# O añadir todos los cambios de una vez (con cuidado)
git add .

# Crear el commit con un mensaje descriptivo
git commit -m "fix: corregir timeout del gateway provisional"

# En este proyecto hay un script especial que hace add + commit + verifica formato:
bash scripts/committer "fix: corregir timeout" src/installer/index.ts src/installer/conversation.ts
```

**Cómo escribir buenos mensajes de commit:**

```
fix: cosa que se rompía y ya no
feat: nueva funcionalidad añadida
chore: cambio sin impacto en el usuario (versión, limpieza)
docs: solo documentación
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

### Subir tus commits a GitHub (push)

```bash
# Primero integra los cambios remotos para evitar conflictos
git pull --rebase origin main

# Luego sube
git push origin main
```

**Regla de oro:** siempre haz `git pull --rebase` antes de `git push`.

### Descargar cambios de GitHub sin tocar tu código (fetch)

```bash
git fetch origin               # descarga pero no aplica nada
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
# Deshacer el último commit pero CONSERVAR los cambios en los archivos
git reset --soft HEAD~1

# Deshacer el último commit Y también los cambios (peligroso)
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

# 2. Edita el archivo y deja solo lo que quieres
# 3. Marca el conflicto como resuelto
git add archivo-conflictivo.ts

# 4. Continúa el rebase
git rebase --continue

# Si te has liado y quieres cancelar todo
git rebase --abort
```

### "Quiero ver qué había en un archivo hace N commits"

```bash
git log --oneline src/installer/index.ts    # historial del archivo
git show abc1234:src/installer/index.ts     # ver el archivo en ese commit
```

---

## 6. Compilar e instalar Laia Arch

### Requisitos del sistema

```bash
# Verificar que tienes todo instalado
node --version    # debe ser v22.16+ (recomendado v24)
pnpm --version    # debe existir
git --version     # debe existir

# Si falta pnpm
npm install -g pnpm
```

### Clonar y preparar el entorno (primera vez)

```bash
# Clonar el repo
git clone git@github.com:JorgeMP-3/Laia-Arch.git
cd Laia-Arch

# Instalar todas las dependencias
pnpm install
# (tarda varios minutos la primera vez, descarga ~500 MB de dependencias)
```

### Compilar Laia Arch

```bash
# Build completo (actualiza versión + compila + copia assets)
pnpm build:laia-arch

# O directamente con bash
bash scripts/build-laia-arch.sh

# Verificar que compiló bien
node laia-arch.mjs --version
# Debe mostrar: Laia Arch 2026.X.X (hash)
```

### Instalar Laia Arch en una nueva máquina (script automático)

```bash
# Opción 1: desde el repositorio clonado
bash scripts/install-laia-arch.sh

# Opción 2: directamente desde GitHub (cuando el repo sea público)
curl -fsSL https://raw.githubusercontent.com/JorgeMP-3/Laia-Arch/main/scripts/install-laia-arch.sh | bash

# Opciones disponibles:
bash scripts/install-laia-arch.sh --dir /opt/laia-arch   # directorio personalizado
bash scripts/install-laia-arch.sh --update                # actualizar instalación existente
bash scripts/install-laia-arch.sh --no-symlink             # sin crear laia-arch en PATH
```

### Actualizar la versión (fecha de hoy)

```bash
pnpm version:check    # ver si está al día
pnpm version:today    # actualizar fecha sin compilar
pnpm build:laia-arch  # actualiza fecha + compila (todo en uno)
```

### Ejecutar sin instalar (desarrollo)

```bash
# Directamente desde el código fuente
node laia-arch.mjs --help
node laia-arch.mjs --version

# O con pnpm (usa el entorno de desarrollo)
pnpm openclaw --help
```

### Ejecutar tests

```bash
# Tests del instalador (los más importantes para Laia Arch)
pnpm test -- src/installer/

# Todos los tests
pnpm test

# Tests con cobertura
pnpm test:coverage
```

### Verificar formato y linting antes de subir

```bash
pnpm check          # todo (formato + tipos + lint)
pnpm format:fix     # corregir formato automáticamente
pnpm tsgo           # solo verificar tipos TypeScript
```

---

## 7. Referencia rápida de comandos

### Git — día a día

| Qué quieres hacer            | Comando                         |
| ---------------------------- | ------------------------------- |
| Ver estado actual            | `git status`                    |
| Ver cambios en detalle       | `git diff`                      |
| Ver historial                | `git log --oneline -10`         |
| Añadir archivo al staging    | `git add ruta/archivo.ts`       |
| Añadir todo al staging       | `git add .`                     |
| Crear commit                 | `git commit -m "mensaje"`       |
| Subir a GitHub               | `git pull --rebase && git push` |
| Descargar cambios            | `git pull --rebase origin main` |
| Descartar cambios en archivo | `git restore archivo.ts`        |
| Ver ramas                    | `git branch -a`                 |

### Laia Arch — desarrollo

| Qué quieres hacer           | Comando                                      |
| --------------------------- | -------------------------------------------- |
| Compilar                    | `pnpm build:laia-arch`                       |
| Ver versión compilada       | `node laia-arch.mjs --version`               |
| Instalar en máquina nueva   | `bash scripts/install-laia-arch.sh`          |
| Actualizar instalación      | `bash scripts/install-laia-arch.sh --update` |
| Instalar dependencias       | `pnpm install`                               |
| Correr tests del instalador | `pnpm test -- src/installer/`                |
| Correr todos los tests      | `pnpm test`                                  |
| Verificar antes de subir    | `pnpm check`                                 |
| Corregir formato            | `pnpm format:fix`                            |
| Actualizar fecha de versión | `pnpm version:today`                         |

### Workflow completo para subir cambios

```bash
# 1. Ver qué has cambiado
git status
git diff

# 2. Compilar y verificar que todo funciona
pnpm build:laia-arch
pnpm test -- src/installer/

# 3. Verificar formato
pnpm check

# 4. Crear el commit
bash scripts/committer "feat: descripción del cambio" archivo1.ts archivo2.ts

# 5. Subir a GitHub
git pull --rebase origin main
git push origin main
```

---

## Estructura del proyecto (dónde está cada cosa)

```
laia-arch-origen/
│
├── src/installer/          ← El instalador conversacional (núcleo del proyecto)
│   ├── index.ts            ← Orquestador principal
│   ├── conversation.ts     ← Lógica de conversación con la IA
│   ├── bootstrap.ts        ← Autenticación y configuración inicial
│   ├── plan-generator.ts   ← Genera el plan de instalación del servidor
│   ├── executor.ts         ← Ejecuta los pasos del plan
│   ├── credential-manager.ts ← Gestión segura de credenciales
│   └── tools/              ← Herramientas del sistema (DNS, LDAP, Samba...)
│
├── src/cli/                ← CLI y temas visuales
│   ├── tagline.ts          ← El tagline "El arquitecto que construye tu servidor"
│   └── laia-arch-theme.ts  ← Colores y banner visual
│
├── scripts/
│   ├── build-laia-arch.sh  ← Build personalizado (sin canvas)
│   ├── install-laia-arch.sh ← Instalador para máquinas nuevas
│   └── bump-version-today.sh ← Actualiza la versión a la fecha de hoy
│
├── contextLaiaProyect/     ← Documentación interna del proyecto
│   ├── 01-estado-actual.md ← Qué está implementado y qué no
│   ├── 02-proyecto-laia.md ← Visión completa del ecosistema LAIA
│   ├── 03-roadmap.md       ← Hoja de ruta viva del proyecto
│   └── sesion-activa.md    ← Log de sesiones de trabajo
│
├── package.json            ← Versión del proyecto y scripts disponibles
├── laia-arch.mjs           ← Punto de entrada del CLI (generado por el build)
├── README.md               ← Presentación pública del proyecto en GitHub
├── CONTRIBUTING.md         ← Cómo contribuir
└── SECURITY.md             ← Política de seguridad
```

---

_Última actualización: 2026-03-28_
