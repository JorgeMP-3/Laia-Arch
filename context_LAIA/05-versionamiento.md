# Versionamiento de Laia Arch

## Estrategia de versiones

Las versiones de Laia Arch se organizan en dos bloques semánticos independientes más una fecha de compilación.

### Esquema de versión

```
LAIA A:X.Y B:X.Y YYYY.M.D
```

Ejemplo: `LAIA A:2.3 B:1.0 2026.3.29`

## Dos planos de versión

Laia Arch usa dos sistemas compatibles:

- `package.json` -> versión-calendario `YYYY.M.D` para binario, build y release
- `version.manifest.json` -> versión semántica interna por bloques `A` y `B`

La regla práctica es:

- no cambies `package.json` para reflejar `patch/minor/major`
- usa `version.manifest.json` para registrar evolución funcional del instalador y del ecosistema

### Bloque A — Instalador (Laia Arch)

**Responsabilidad:** Fases 0-4 del roadmap. El agente instalador, herramientas del sistema, escaneo, ejecución, verificación, reparación.

**Archivos afectados:**

- `src/installer/**/*` (bootstrap, conversation, executor, scanner, etc.)
- `src/installer/tools/**/*` (credential, service, network, ldap, samba, system, verify)
- `src/installer/presets/**/*`
- `src/cli/laia-arch-theme.ts`
- `scripts/detect-version-increment.ts`
- `scripts/update-version.ts`

**Qué triggeriza un increment:**

- **Patch (A:X.Y → A:X.Y+1):** Bug fixes, mejoras menores, refactores internos sin cambio de API
  - Ejemplo: fix en PKCE, mejora en retry logic, refactor de función privada
  - Criterio: el instalador sigue funcionando igual para el usuario final

- **Minor (A:X → A:X+1.0):** Nuevas capacidades, herramientas o estrategias de instalación
  - Ejemplo: soporte para nuevo tipo de servidor, nueva verificación, nuevo preset
  - Criterio: el instalador ahora puede hacer más cosas; la conversación/plan/ejecución expande su cobertura

- **Major (A → A+1.0.0):** Cambio fundamental en la arquitectura o contrato del agente
  - Ejemplo: cambio del motor agentic, nueva fase, cambio radical de UI
  - Criterio: no es compatible con instalaciones previas; requiere redesplegar

### Bloque B — Ecosistema post-instalación

**Responsabilidad:** Fases 5-8 del roadmap. Laia Agora (operaciones), Laia Nemo (acceso externo), UI de Arch post-instalación.

**Archivos afectados:**

- `src/agora/**/*` (cuando exista más que templates)
- `src/nemo/**/*` (cuando exista más que templates)
- `src/provider-web.ts` (UI web del ecosistema)
- `apps/macos/Sources/**/*` (UI de control del servidor)
- `docs/` no cuenta para el bump automático

**Nota:** Mientras Agora y Nemo sigan siendo base/fundación, el bump de `B` debe reservarse a capacidades reales del ecosistema, no a documentación o templates sueltos.

**Qué triggeriza un increment:**

- **Patch (B:X.Y → B:X.Y+1):** Bug fixes en APIs de Agora/Nemo, mejoras de performance, cambios de UX menores
  - Criterio: el flujo de uso sigue siendo el mismo

- **Minor (B:X → B:X+1.0):** Nuevas funcionalidades en Agora/Nemo, nuevos puntos de integración con el host
  - Ejemplo: nueva app en Agora, nuevo canal en Nemo, nueva capacidad de Arch post-instalación
  - Criterio: el ecosistema ahora puede hacer más cosas operacionalmente

- **Major (B → B+1.0.0):** Cambio de arquitectura del ecosistema, cambio de protocolo inter-agentes
  - Ejemplo: cambio en bus inter-agente, reorganización fundamental de Agora
  - Criterio: requiere redeploy, reorganización de dependencias

### Fecha de compilación

**Formato:** `YYYY.M.D` (año de 4 dígitos, mes de 1-2, día de 1-2)

**Cuándo actualizar:** Cada vez que se haga un build oficial o release. Se actualiza automáticamente.

## Archivos de versión

### `version.manifest.json`

Ubicación: `/home/laia-arch/laia-arch-origen/version.manifest.json`

Estructura:

```json
{
  "format": "1.0",
  "blocks": {
    "A": {
      "major": 2,
      "minor": 3,
      "patch": 0,
      "description": "Laia Arch as installer — hybrid agentic motor + OAuth Codex integration",
      "changes": [
        "Fixed Codex OAuth endpoint (PKCE, /oauth/ path, Responses API)",
        "Added semantic versioning for blocks A and B"
      ],
      "lastUpdated": "2026.3.29",
      "contributors": ["Codex", "Claude Code"]
    },
    "B": {
      "major": 1,
      "minor": 0,
      "patch": 0,
      "description": "Post-installation ecosystem — Agora base (templates), Nemo foundation",
      "changes": ["Base templates for Agora and Nemo"],
      "lastUpdated": "2026.3.14",
      "contributors": []
    }
  },
  "compilationDate": "2026.3.29",
  "gitCommit": "unknown",
  "buildNumber": 719
}
```

## Script de detección automática de cambios

**Ubicación:** `scripts/detect-version-increment.ts`

**Función:** Analiza cambios en Git desde el último tag o commit, clasifica por bloques y sugiere incrementos de versión.

**Uso:**

```bash
# Detectar cambios desde HEAD~10
node --import tsx scripts/detect-version-increment.ts --since-commits 10

# Detectar cambios desde un commit específico
node --import tsx scripts/detect-version-increment.ts --since dd4e6f1

# Detectar cambios desde el último tag
node --import tsx scripts/detect-version-increment.ts --since-tag

# Salida estructurada para otra IA o script
node --import tsx scripts/detect-version-increment.ts --since-commits 1 --json
```

**Output:**

```
Block A changes detected (2 files):
  - src/installer/bootstrap.ts
  - src/installer/provisional-gateway.ts

Suggestion: A:2.3.0 → A:2.4.0 (minor)
Confidence: HIGH
Reason: Nueva capacidad o herramienta detectada en installer and setup engine

Ignored files with no version impact: 3

Uncategorized files outside A/B blocks: 1
```

El detector ya sabe diferenciar:

- `suggestions`: bloques que sí deben subir
- `ignored`: docs, tests, contexto, `.github`, etc.
- `uncategorized`: archivos tocados que no pertenecen a `A` o `B`

## Integración en el instalador

### Bootstrap.ts — Mostrar versión al iniciar

La versión se lee desde `version.manifest.json` y se mostrará en:

1. Banner inicial del instalador (en `laia-arch-theme.ts`)
2. Logs de sesión
3. Verificación final de instalación

### Cambios en `laia-arch-theme.ts`

El banner agregará la versión y bloque activo:

```
⚡ L A I A   A R C H
El arquitecto que construye tu servidor

LAIA A:2.3 B:1.0 2026.3.29
Build: 719 | Installer Phase
```

## Política de actualización

### Cuándo actualizar el manifest

1. **Antes de un release:** revisar el diff, correr el detector y decidir si hay bump en `A`, `B` o ninguno.
2. **En desarrollo:** IAs y desarrolladores pueden actualizar manualmente el manifest cuando el cambio ya esté claro.
3. **Build oficial:** mantiene la fecha/calver en `package.json`, pero no sustituye la decisión semántica del manifest.

### Antes de commit

Ejecutar:

```bash
node --import tsx scripts/detect-version-increment.ts --since-commits 1
```

Si hay cambios significativos, actualizar `version.manifest.json` con:

```bash
node --import tsx scripts/update-version.ts --block A --bump minor
```

Si no hay cambios significativos, no hagas bump.

## Ejemplos de decisión

### Cambio: Fix en validación de OAuth en bootstrap.ts

Análisis:

- Archivo: `src/installer/bootstrap.ts`
- Cambio: Fix en `validateOAuthToken()` (función privada)
- Impacto: El instalador sigue funcionando igual, solo más confiable

**Decisión:** Patch → `A:2.0.X → A:2.0.(X+1)`

### Cambio: Nuevo preset de instalación para "Enterprise High Security"

Análisis:

- Archivos: `src/installer/presets/**/*`, `src/installer/conversation.ts` (nueva rama de preguntas)
- Cambio: El instalador ahora puede instalar de forma radicalmente diferente
- Impacto: Nueva capacidad visible desde la conversación

**Decisión:** Minor → `A:2.0 → A:2.1`

### Cambio: Rewrite del motor agentic de fases 1-4

Análisis:

- Archivos: `src/installer/executor.ts`, `src/installer/agentic.ts`, `src/installer/index.ts`, cambios en contrato con conversación
- Cambio: El motor que ejecuta cambios es completamente diferente
- Impacto: No es retrocompatible; instalaciones activas pueden no poder reanudar

**Decisión:** Major → `A:2.0 → A:3.0.0`

### Cambio: Nuevo canal en Nemo (Slack bot)

Análisis:

- Archivos: `src/nemo/**/*`, docs
- Cambio: Nemo ahora puede recibir desde Slack además de WhatsApp/Telegram
- Impacto: Nueva capacidad del ecosistema post-instalación

**Decisión:** Minor → `B:1.0 → B:1.1`

## Estado actual del sistema

- [x] Existe `version.manifest.json`
- [x] Existe `scripts/detect-version-increment.ts`
- [x] Existe `scripts/update-version.ts`
- [x] `src/installer/bootstrap.ts` ya muestra versión en el banner vía `version-info.ts`
- [x] `src/cli/laia-arch-theme.ts` ya acepta la versión para el banner
- [x] El detector ya tiene salida `--json`
- [ ] Configurar hook pre-commit que sugiera version bump
- [ ] Exponer mejor la versión `A/B` también en más superficies del CLI si se considera necesario
