# Guía práctica de versionamiento para desarrolladores

## Resumen rápido

El proyecto usa versioning semántico con **dos bloques independientes**:

- **Bloque A** (instalador Laia Arch)
- **Bloque B** (ecosistema post-instalación: Agora, Nemo)

**Formato:** `LAIA A:X.Y B:X.Y YYYY.M.D`

Ejemplo: `LAIA A:2.2 B:1.0 2026.3.29`

## Cómo funciona

### 1. El archivo de versión

Ubicación: `/version.manifest.json`

Contiene:

- Versión mayor.menor.patch para cada bloque
- Descripción de cambios
- Fecha de compilación
- Hash de git commit

Se actualiza **antes de hacer release** o cuando se detectan cambios significativos.

### 2. Cambios detectados automáticamente

El proyecto incluye un script que analiza git diffs y sugiere qué versiones actualizar.

```bash
# Ver qué cambios hay desde hace 5 commits
node --import tsx scripts/detect-version-increment.ts --since-commits 5

# O desde el último tag
node --import tsx scripts/detect-version-increment.ts --since-tag
```

**Output típico:**

```
Block A changes detected (5 files):
  - src/installer/bootstrap.ts (OAuth fix)
  - src/installer/conversation.ts (new branch)

Suggestion: A:2.1 → A:2.2 (minor bump)
Confidence: HIGH
Reason: New OAuth flow changes (961 additions)
```

### 3. Actualizar la versión

Cuando detectes cambios significativos o antes de un release:

```bash
# Incrementar patch de Block A (2.2.0 → 2.2.1)
node --import tsx scripts/update-version.ts --block A --bump patch

# Incrementar minor de Block A (2.2.0 → 2.3.0)
node --import tsx scripts/update-version.ts --block A --bump minor

# Incrementar major de Block A (2.2.0 → 3.0.0)
node --import tsx scripts/update-version.ts --block A --bump major
```

El script automáticamente:

- Actualiza la fecha de compilación
- Obtiene el commit hash actual
- Escribe el manifest actualizado

## Decisiones de versioning

### Block A — Laia Arch instalador

**Patch** (A:X.Y.Z → A:X.Y.Z+1)

- Bug fixes en bootstrap, conversation, executor
- Mejoras internas sin cambios de API
- Refactores que mantienen el mismo comportamiento
- Ejemplo: fix en PKCE, mejora en retry logic

**Minor** (A:X.Y → A:X.Y+1)

- Nuevas herramientas o capacidades del instalador
- Nuevo preset de instalación
- Nueva estrategia de verificación
- Cambios en el flujo de conversación (nuevas preguntas/ramas)
- Ejemplo: soporte para OAuth Codex, nuevo verificador LDAP

**Major** (A:X → A:X+1.0.0)

- Cambio de arquitectura del agente (agentic motor)
- Nueva fase de instalación
- Cambio incompatible con instalaciones previas
- Redesign del contrato entre componentes
- Ejemplo: cambio radical en plan-generator, nueva fase de reparación

### Block B — Ecosistema post-instalación

**Patch** (B:X.Y.Z → B:X.Y.Z+1)

- Bug fixes en APIs de Agora/Nemo
- Mejoras de performance
- Cambios menores de UX

**Minor** (B:X.Y → B:X.Y+1)

- Nuevas funcionalidades en Agora (nuevas apps, espacios)
- Nuevos canales en Nemo (nuevo bot de Slack, por ejemplo)
- Nuevas capacidades post-instalación de Arch

**Major** (B:X → B:X+1.0.0)

- Cambio de arquitectura del ecosistema
- Cambio de protocolo inter-agentes
- Rediseño completo de una capa

## Flujo típico de desarrollo

### 1. Trabajar en features

```bash
# Crear rama, hacer cambios
git checkout -b feature/new-oauth-provider
# ... editar código ...
git add .
git commit -m "Add OAuth provider X"
```

### 2. Detectar cambios antes de commit

```bash
# Ver qué version se sugiere
node --import tsx scripts/detect-version-increment.ts --since-commits 1
```

### 3. Si es un cambio significativo, actualizar versión

```bash
# Versión anterior: A:2.1.0
# Cambio: nueva rama de conversación para OAuth
node --import tsx scripts/update-version.ts --block A --bump minor
# Resultado: A:2.2.0
```

### 4. Commit los cambios de código y version

```bash
git add src/installer/* version.manifest.json
git commit -m "Add OAuth Provider X — bump to A:2.2"
```

### 5. Release

```bash
# Ver versión actual
cat version.manifest.json | jq '.compilationDate'

# Build se ejecuta
pnpm build:laia-arch
# Automáticamente actualiza compilationDate a hoy

# Push a main
git push origin feature/new-oauth-provider
```

## Visualizar versión actual

### En el instalador (banner)

Al ejecutar `laia-arch install`, la versión aparece en el banner:

```
  ╔══════════════════════════════════════════════════════════╗
  ║                                                          ║
  ║           ⚡ L A I A   A R C H                        ║
  ║       El arquitecto que construye tu servidor       ║
  ║       LAIA A:2.2 B:1.0 2026.3.29                    ║
  ║                                                          ║
```

### En CLI

```bash
$ laia-arch --version
Laia Arch 2026.3.29 (d35e703)
```

### En el manifest

```bash
cat version.manifest.json | jq '.blocks | .A'
```

Output:

```json
{
  "major": 2,
  "minor": 2,
  "patch": 0,
  "description": "Laia Arch as installer — hybrid agentic motor + OAuth Codex integration",
  "changes": ["Fixed Codex OAuth endpoint", "Added semantic versioning system"],
  "lastUpdated": "2026-03-29",
  "contributors": ["Codex", "Claude Code"]
}
```

## Notas importantes

### Cuando NO actualizar versión

- Cambios en documentación (docs/, context_LAIA/, README)
- Cambios en tests
- Cambios en CI/CD (.github/)
- Cambios en configuración de linters (oxlint, eslint)

### Cuando SÍ actualizar versión

- Cualquier cambio en `src/installer/**`
- Cambios en `src/agora/**` o `src/nemo/**` con código nuevo (no templates)
- Cambios en comportamiento del instalador
- Cambios visibles para el usuario

### Automatización futura

Planeado (no implementado aún):

- Hook pre-commit que sugiera version bump
- CI que detecte cambios y alerta si no hay version bump
- Changelog automático generado desde el manifest

## Preguntas frecuentes

**P: ¿Quién decide si es patch vs minor vs major?**
R: El desarrollador que hace el cambio. Si tienes dudas, corre `detect-version-increment.ts` y confía en su sugerencia de "confidence".

**P: ¿Puedo hacer varios bumps en un commit?**
R: Sí. Si afectas ambos bloques, puedes actualizar A y B en el mismo commit:

```bash
node --import tsx scripts/update-version.ts --block A --bump minor
node --import tsx scripts/update-version.ts --block B --bump patch
```

**P: ¿Y si me equivoco de versión?**
R: Solo edita `version.manifest.json` manualmente y commit de nuevo. El manifest es la fuente de verdad.

**P: ¿A qué block afectan los cambios en src/cli/?**
R: En general, `src/cli/` es parte de Block A (instalador) porque es usada durante bootstrap. Cambios en theming/presentación = patch. Cambios en flujo/opciones = minor.
