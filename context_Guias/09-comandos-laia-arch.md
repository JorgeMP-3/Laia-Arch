# Comandos de Laia Arch — compilar, instalar y operar

Todo lo que necesitas para trabajar con Laia Arch: dependencias, instalación, compilación,
verificaciones y ejecución.

---

## Índice

1. [Dependencias necesarias](#1-dependencias-necesarias)
2. [Preparar el entorno por primera vez](#2-preparar-el-entorno-por-primera-vez)
3. [Instalar Laia Arch en una máquina nueva](#3-instalar-laia-arch-en-una-máquina-nueva)
4. [Compilar desde el código fuente](#4-compilar-desde-el-código-fuente)
5. [Ejecutar Laia Arch](#5-ejecutar-laia-arch)
6. [Verificaciones antes de subir cambios](#6-verificaciones-antes-de-subir-cambios)
7. [Tests](#7-tests)
8. [Gestión de versiones](#8-gestión-de-versiones)
9. [Workflow completo de un día de trabajo](#9-workflow-completo-de-un-día-de-trabajo)
10. [Referencia rápida](#10-referencia-rápida)

---

## 1. Dependencias necesarias

Laia Arch necesita estas herramientas instaladas en la máquina:

| Herramienta | Versión mínima             | Para qué sirve                           |
| ----------- | -------------------------- | ---------------------------------------- |
| **Node.js** | v22.16+ (recomendado v24)  | Ejecutar el código JavaScript/TypeScript |
| **pnpm**    | cualquier versión reciente | Gestionar dependencias del proyecto      |
| **git**     | cualquier versión reciente | Control de versiones                     |

### Verificar que tienes todo

```bash
node --version    # debe mostrar v22.x.x o superior
pnpm --version    # debe mostrar un número de versión
git --version     # debe mostrar git version X.X.X
```

### Instalar lo que falte

**Node.js** (si no está instalado):

```bash
# En Ubuntu/Debian — instalar Node 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**pnpm** (si no está instalado):

```bash
npm install -g pnpm
```

**git** (si no está instalado):

```bash
sudo apt-get install git       # Ubuntu/Debian
sudo pacman -S git             # Arch Linux
```

---

## 2. Preparar el entorno por primera vez

Estos pasos solo se hacen una vez cuando clonas el proyecto en una máquina nueva.

```bash
# 1. Clonar el repositorio
git clone git@github.com:JorgeMP-3/Laia-Arch.git
cd Laia-Arch

# 2. Instalar todas las dependencias del proyecto
pnpm install
# Tarda varios minutos la primera vez — descarga ~500 MB de paquetes
# Es normal que tarde, no lo interrumpas

# 3. Verificar que el entorno está bien
node --version
pnpm --version
```

### Si pnpm install falla

```bash
# Limpiar caché y reintentar
pnpm store prune
pnpm install

# Si sigue fallando, borrar node_modules y reinstalar desde cero
rm -rf node_modules
pnpm install
```

---

## 3. Instalar Laia Arch en una máquina nueva

El script `install-laia-arch.sh` hace todo automáticamente: clona, instala dependencias y compila.

```bash
# Desde el repositorio ya clonado
bash scripts/install-laia-arch.sh

# Directamente desde GitHub (la máquina debe tener internet, node y pnpm)
curl -fsSL https://raw.githubusercontent.com/JorgeMP-3/Laia-Arch/main/scripts/install-laia-arch.sh | bash
```

### Opciones del instalador

```bash
# Instalar en un directorio específico (por defecto: ~/.local/share/laia-arch)
bash scripts/install-laia-arch.sh --dir /opt/laia-arch

# Actualizar una instalación que ya existe
bash scripts/install-laia-arch.sh --update

# Instalar sin crear el acceso directo laia-arch en el PATH
bash scripts/install-laia-arch.sh --no-symlink

# Ver todas las opciones disponibles
bash scripts/install-laia-arch.sh --help
```

### Qué hace el instalador automáticamente

1. Verifica que Node.js, pnpm y git están instalados
2. Clona el repositorio en el directorio de destino
3. Ejecuta `pnpm install` para instalar dependencias
4. Compila con `scripts/build-laia-arch.sh`
5. Crea el acceso directo `laia-arch` en `~/.local/bin/`

---

## 4. Compilar desde el código fuente

La compilación convierte el código TypeScript en JavaScript ejecutable.

```bash
# Build completo de Laia Arch (actualiza versión + compila + copia assets)
pnpm build:laia-arch

# O directamente con el script bash
bash scripts/build-laia-arch.sh
```

### Qué hace el build paso a paso

1. Actualiza la versión en `package.json` a la fecha de hoy
2. Compila TypeScript → JavaScript con `tsdown`
3. Genera metadatos del CLI (versión, compat, startup)
4. Copia metadatos de hooks
5. Copia plantillas HTML de exportación

### Verificar que compiló correctamente

```bash
node laia-arch.mjs --version
# Debe mostrar: Laia Arch 2026.X.X (hash-del-commit)

node laia-arch.mjs --help
# Debe mostrar los comandos disponibles
```

### Si el build falla

```bash
# Ver el error completo
pnpm build:laia-arch 2>&1 | head -50

# Problema habitual: dependencias desactualizadas
pnpm install
pnpm build:laia-arch

# Problema con TypeScript: ver errores de tipos
pnpm tsgo
```

---

## 5. Ejecutar Laia Arch

### Desde el código fuente (modo desarrollo)

```bash
# Ver ayuda y comandos disponibles
node laia-arch.mjs --help

# Ver la versión actual
node laia-arch.mjs --version

# Lanzar el instalador conversacional
node laia-arch.mjs installer

# Lanzar el gateway
node laia-arch.mjs gateway run --port 18789

# Enviar un mensaje de prueba
node laia-arch.mjs agent --message "Hola, ¿estás operativo?"
```

### Desde el acceso directo instalado (si usaste install-laia-arch.sh)

```bash
# Mismos comandos pero sin "node" delante
laia-arch --help
laia-arch --version
laia-arch installer
laia-arch gateway run --port 18789
```

### Ver si el gateway está corriendo

```bash
ss -ltnp | grep 18789
# Si hay una línea con 18789, el gateway está activo

# Ver los logs del gateway
tail -f /tmp/openclaw-gateway.log
```

---

## 6. Verificaciones antes de subir cambios

Antes de hacer `git push`, ejecuta estas comprobaciones en orden.

### Verificación rápida (cambios pequeños)

```bash
# 1. Compilar y verificar que no hay errores
pnpm build:laia-arch

# 2. Verificar formato, tipos y lint de golpe
pnpm check
```

### Verificación completa (cambios importantes)

```bash
# Formato — verificar sin modificar
pnpm format:check

# Formato — corregir automáticamente
pnpm format:fix

# Tipos TypeScript
pnpm tsgo

# Lint (reglas de código)
pnpm lint

# Todo junto (lo que hace el pre-commit automáticamente)
pnpm check
```

### Qué significa cada error

| Error                | Qué significa                          | Cómo resolverlo                  |
| -------------------- | -------------------------------------- | -------------------------------- |
| `format error`       | El código no tiene el formato correcto | Ejecuta `pnpm format:fix`        |
| `type error`         | Un tipo TypeScript no coincide         | Lee el error, corrige el archivo |
| `lint warning/error` | El código rompe una regla de estilo    | Lee el mensaje del error         |
| `build failed`       | El código no compila                   | Lee el error de compilación      |

---

## 7. Tests

Los tests verifican que el código funciona como se espera.

### Tests del instalador (los más importantes para Laia Arch)

```bash
# Solo tests del instalador
pnpm test -- src/installer/

# Un archivo de test específico
pnpm test -- src/installer/executor.test.ts

# Con filtro por nombre de test
pnpm test -- src/installer/ -t "modo adaptive"
```

### Todos los tests del proyecto

```bash
pnpm test

# Con cobertura (muestra qué % del código está cubierto por tests)
pnpm test:coverage
```

### Si los tests consumen mucha memoria (normal en servidores con poca RAM)

```bash
OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
```

### Interpretar el resultado

```
✓  57 tests passed   ← todo bien
✗   2 tests failed   ← hay que revisar los errores
```

---

## 8. Gestión de versiones

La versión sigue el formato `YYYY.M.D` (año.mes.día sin ceros a la izquierda).
Por ejemplo: `2026.3.28` es el 28 de marzo de 2026.

```bash
# Ver la versión actual en package.json
node -p "require('./package.json').version"

# Ver la versión compilada
node laia-arch.mjs --version

# Comprobar si la versión está al día
pnpm version:check

# Actualizar la versión a la fecha de hoy (sin compilar)
pnpm version:today

# Actualizar versión + compilar (todo en uno — lo más habitual)
pnpm build:laia-arch
```

---

## 9. Workflow completo de un día de trabajo

Este es el flujo que debes seguir cada vez que hagas cambios.

```bash
# ── Antes de empezar ──────────────────────────────────────────────
# Descargar los últimos cambios del remoto
git pull --rebase origin main

# ── Hacer los cambios ─────────────────────────────────────────────
# (edita los archivos que necesites)

# ── Verificar que todo está bien ──────────────────────────────────
# Compilar
pnpm build:laia-arch

# Tests del área que tocaste
pnpm test -- src/installer/

# Verificar formato y tipos
pnpm check

# ── Guardar y subir ───────────────────────────────────────────────
# Crear el commit (el script verifica formato automáticamente)
bash scripts/committer "feat: descripción de lo que hiciste" archivo1.ts archivo2.ts

# Subir a GitHub
git pull --rebase origin main
git push origin main
```

---

## 10. Referencia rápida

### Compilar y ejecutar

| Qué quieres hacer     | Comando                          |
| --------------------- | -------------------------------- |
| Compilar Laia Arch    | `pnpm build:laia-arch`           |
| Ver versión compilada | `node laia-arch.mjs --version`   |
| Ver ayuda del CLI     | `node laia-arch.mjs --help`      |
| Lanzar el instalador  | `node laia-arch.mjs installer`   |
| Lanzar el gateway     | `node laia-arch.mjs gateway run` |

### Dependencias y entorno

| Qué quieres hacer           | Comando                                      |
| --------------------------- | -------------------------------------------- |
| Instalar dependencias       | `pnpm install`                               |
| Instalar en máquina nueva   | `bash scripts/install-laia-arch.sh`          |
| Actualizar instalación      | `bash scripts/install-laia-arch.sh --update` |
| Actualizar fecha de versión | `pnpm version:today`                         |

### Verificaciones

| Qué quieres hacer     | Comando             |
| --------------------- | ------------------- |
| Verificar todo        | `pnpm check`        |
| Solo formato          | `pnpm format:check` |
| Corregir formato      | `pnpm format:fix`   |
| Solo tipos TypeScript | `pnpm tsgo`         |
| Solo lint             | `pnpm lint`         |

### Tests

| Qué quieres hacer      | Comando                               |
| ---------------------- | ------------------------------------- |
| Tests del instalador   | `pnpm test -- src/installer/`         |
| Todos los tests        | `pnpm test`                           |
| Tests con cobertura    | `pnpm test:coverage`                  |
| Tests con poca memoria | `OPENCLAW_TEST_PROFILE=low pnpm test` |

---

_Última actualización: 2026-03-28_
