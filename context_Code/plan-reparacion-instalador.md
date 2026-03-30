# Plan de reparación del instalador — incidencias reales

> Documento operativo bajo responsabilidad de Claude Code.
> Recoge diagnóstico, causa raíz, fix aplicado y criterios de validación real.
> Codex no edita este archivo.

---

## Incidencia A — PROMPTS_DIR falla en máquina nueva (modo Asistido, Fase 2)

### Síntoma

```
ENOENT: no such file or directory, open '/home/jorgetm/.local/share/install-prompts/00-system-context.md'
```

### Causa raíz confirmada

El primer fix (commit `69ce356007`) usó `import.meta.url` con la ruta relativa
`../../install-prompts`. Eso asumía que el bundle compilado estaría en
`dist/installer/conversation.js`. Pero tsdown **no incluye `conversation.ts`
como entrada separada**: lo bundlea en `dist/installer-<hash>.js` (plano en
`dist/`).

A runtime la resolución era:

```
import.meta.url → dist/installer-zYgzOoXA.js
_moduleDir      → .local/share/laia-arch/dist/
../../          → .local/share/               ← nivel incorrecto
```

Eso producía `/home/jorgetm/.local/share/install-prompts/` — exactamente el
error observado. El fix funcionaba en desarrollo con `tsx` porque ahí
`import.meta.url` apunta a `src/installer/conversation.ts`, donde `../../`
sí llega al raíz del proyecto.

Evidencia directa: línea 2126 del bundle `dist/installer-zYgzOoXA.js` en la
máquina afectada.

### Fix aplicado

Commit `668223c19b` — `src/installer/conversation.ts`.

Implementa `resolvePromptBaseDir()` con cinco candidatos en orden:

1. `LAIA_ARCH_PROMPTS_DIR` (env override para debugging)
2. `../../install-prompts` desde `import.meta.url` (bundle plano, sigue presente como candidato)
3. raíz del paquete vía `resolveOpenClawPackageRoot()` + `/install-prompts`
4. `process.cwd() + /install-prompts`
5. `~/.local/share/laia-arch/install-prompts`

El candidato 3 o 4 siempre resolverá correctamente en instalación normal,
incluso si el candidato 2 sigue apuntando al nivel incorrecto.

### Pendiente: validación en máquina real

```bash
# En la máquina jorgetm — actualizar instalación
cd ~/.local/share/laia-arch
git pull --rebase origin main
bash scripts/build-laia-arch.sh

# Confirmar que el fix está en el bundle
grep -c "LAIA_ARCH_PROMPTS_DIR" dist/installer-*.js
# Debe devolver 1 o más

# Probar modo Asistido
laia-arch install --mode guided
# Debe avanzar Fase 2 sin ENOENT
```

Criterio de cierre: modo Asistido pasa Fase 2 sin errores de ruta en la
máquina real.

---

## Incidencia B — Scanner no representa hosts con varias interfaces

### Síntoma

El resumen del escaneo mostraba una sola IP local aunque el host tenía varias
interfaces activas (LAN + Docker bridge + VPN u otras).

### Causa raíz confirmada

`src/installer/scanner.ts` usaba tres `head -1` consecutivos para derivar
`localIp`, `gateway` y `subnet`:

```typescript
run("ip route get 1.1.1.1 ... | head -1"); // un solo IP
run("ip route | grep default ... | head -1"); // un solo gateway
run("ip route | grep -v default ... | head -1 | awk '{print $1}'"); // una sola subnet
```

Solo se modelaba la ruta primaria hacia internet.

### Fix aplicado

Commit `668223c19b` — `src/installer/scanner.ts` y `src/installer/types.ts`.

- `scanner.ts`: enumera todas las interfaces IPv4 activas y genera metadatos
  por interfaz
- `types.ts`: nuevo campo `network.interfaces?` en el artefacto de escaneo
- `localIp` y `gateway` se conservan para compatibilidad como interfaz/ruta
  primaria

### Pendiente: validación en máquina real

```bash
# Ver qué interfaces tiene el host
ip -o addr show | grep "inet " | grep -v "127.0.0.1"

# Lanzar el instalador y comprobar el resumen del escaneo
laia-arch install
# El resumen debe mostrar todas las interfaces, no solo una
```

Criterio de cierre: el resumen del escaneo lista las mismas interfaces que
devuelve `ip -o addr show` en la máquina real.

---

## Estado actual (2026-03-30)

| Incidencia                 | Fix en repo              | Validado en máquina real                        |
| -------------------------- | ------------------------ | ----------------------------------------------- |
| A — PROMPTS_DIR            | Sí (commit `668223c19b`) | **Sí** — 2026-03-30, update real verificado     |
| B — Scanner multi-interfaz | Sí (commit `668223c19b`) | Pendiente — requiere host con varias interfaces |

---

## Criterios de cierre total

1. modo Asistido pasa Fase 2 sin ENOENT en la máquina `jorgetm`
2. el resumen del scanner muestra varias interfaces cuando existen
3. este documento actualizado con fecha y evidencia de validación real
4. nota en `context_Code/sesion-activa.md` con el resultado

---

## Registro de sesiones de diagnóstico

### 2026-03-30 — Claude Code

- Diagnóstico de causa raíz: inspección directa del bundle
  `dist/installer-zYgzOoXA.js`, confirmada ruta `../../` incorrecta para
  bundle plano
- Hipótesis H1 (instalación vieja): descartada
- Hipótesis H2 (ruta alternativa): confirmada como causa raíz real
- Hipótesis H3 (scanner una interfaz): confirmada por análisis de código
- Fix propuesto y aplicado por Codex: multi-ruta en `conversation.ts` +
  multi-interfaz en `scanner.ts`
- `scripts/build-laia-arch.sh` endurecido con verificación post-build de
  artefactos críticos (`laia-arch.mjs`, `install-prompts/`, `dist/`)
