# LAIA — Plan de ejecución compartido para Codex y Claude Code

## Resumen

Objetivo inmediato:

Llevar `Laia Arch` de instalador determinista con capa conversacional a motor híbrido agentic, sin romper la base actual, y dejar preparado el camino al MVP `Laia Arch + Laia Agora base`.

Reparto principal:

- Codex lidera arquitectura, estado interno, motor de ejecución, herramientas, verificación, integración y documentación viva.
- Claude Code lidera conversación adaptativa, prompts, comportamiento del agente instalador, rescate unificado y contratos de decisión del agente.
- Ambos trabajan en paralelo con límites de escritura separados y un punto de integración claro en `src/installer/types.ts`.

## Plan por responsable

### Codex

Responsabilidad principal:

Convertir el núcleo técnico del instalador en una plataforma agentic segura.

Cambios a liderar:

- Diseñar y fijar en `src/installer/types.ts` los tipos compartidos:
  - `InstallationGoal`
  - `ConversationIntent`
  - `InstallationSnapshot`
  - `ActionProposal`
  - `ActionExecution`
  - `VerificationReport`
  - `RepairAttempt`
  - `InstallSessionState`
- Refactorizar `src/installer/executor.ts` para que el flujo principal sea:
  - `observar -> proponer -> aprobar -> ejecutar -> verificar -> reparar -> continuar`
- Mantener `src/installer/plan-generator.ts` como fallback seguro y compatibilidad durante la transición.
- Normalizar `src/installer/tools/` para que todas las herramientas devuelvan resultados homogéneos y útiles para razonamiento operativo.
- Hacer obligatoria la verificación tras cambios relevantes y bloquear “éxitos falsos” con exit code 0 sin estado válido.
- Diseñar la capa de persistencia del estado de instalación para reanudación real con contexto operativo, no solo pasos completados.
- Mantener actualizados `contextLaiaProyect/01-estado-actual.md` y `contextLaiaProyect/03-roadmap.md` cuando cambie la realidad del sistema.

Entrega esperada de Codex:

- motor híbrido listo para consumir decisiones del agente
- estado interno compartido estable
- herramientas y verificación endurecidas
- documentación viva alineada con el código

Estado real actual de esta línea:

- tipos compartidos, sesión persistida, propuestas, verificación y reparaciones ya existen
- el executor ya soporta clean restart preservando secretos de instalación
- el trabajo pendiente principal ya no es “crear la base”, sino empujar el razonamiento para que mande más que el plan derivado

### Claude Code

Responsabilidad principal:

Hacer que el agente piense y converse como Laia Arch, no como un wizard.

Cambios a liderar:

- Rediseñar `src/installer/conversation.ts` para que produzca intención estructurada y no una preconfiguración casi cerrada.
- Reforzar el modo `adaptive` para que cambie de tema, vuelva atrás, resuelva contradicciones y complete huecos sin perder el hilo.
- Mantener `guided` como modo predecible basado en `install-prompts/00-06.md`, pero preparado para alimentar el mismo motor agentic.
- Definir el contrato de decisión del agente:
  - qué sabe del sistema
  - qué propuesta devuelve
  - cómo justifica el cambio
  - cómo declara verificación y rollback
- Unificar conceptualmente instalación y rescate:
  - el rescate debe ser el mismo cerebro con más libertad diagnóstica, no otra personalidad separada
- Refinar prompts del instalador para que prioricen:
  - contexto empresarial
  - observación del host
  - explicación breve de decisiones
  - reparación autónoma antes de escalar
- Preparar el comportamiento conversacional necesario para la futura activación de `Laia Agora` como siguiente capa del ecosistema.

Entrega esperada de Claude Code:

- conversación realmente adaptativa
- contrato claro entre razonamiento del agente y motor de ejecución
- rescate integrado en la misma lógica de instalación
- prompts alineados con la visión LAIA

## Protocolo de coordinación

### Orden de trabajo

1. Codex fija primero los tipos compartidos en `src/installer/types.ts`.
2. Claude Code adapta conversación y contrato del agente contra esos tipos.
3. Codex integra el nuevo motor en `src/installer/executor.ts` y adapta herramientas.
4. Claude Code ajusta rescate y prompts finales con el motor ya integrado.
5. Codex cierra verificación, persistencia y documentación.
6. Integración conjunta del camino hacia `Laia Agora` base.

### Límites de escritura

Propiedad principal de Codex:

- `src/installer/types.ts`
- `src/installer/executor.ts`
- `src/installer/tools/`
- `contextLaiaProyect/01-estado-actual.md`
- `contextLaiaProyect/03-roadmap.md`

Propiedad principal de Claude Code:

- `src/installer/conversation.ts`
- `install-prompts/`
- `workspace-templates/`
- prompts o helpers del razonamiento del instalador

Regla:

- no tocar simultáneamente el mismo archivo salvo en ventana de integración acordada
- cualquier cambio en interfaces compartidas se refleja primero en `src/installer/types.ts`
- cualquier cambio de visión se refleja también en la carpeta `contextLaiaProyect/`

### Handoffs obligatorios

Cada responsable debe dejar en cada entrega:

- qué cambió
- qué contrato nuevo introduce o consume
- qué comportamiento observable cambia
- qué pruebas cubren ese cambio
- qué queda bloqueado para el siguiente responsable

## Pruebas y criterios de aceptación

Pruebas mínimas para dar una fase por buena:

- `adaptive` ya no depende de un plan fijo como camino principal.
- El motor puede reanudar con estado operativo, no solo con IDs de pasos.
- Un cambio importante no se marca como correcto sin verificación explícita.
- Un fallo entra en diagnóstico y reparación sin cambiar de “modo mental”.
- El fallback determinista sigue funcionando si el modo agentic no converge.
- La documentación de `contextLaiaProyect/` sigue reflejando el estado real.
- La reinstalación limpia no rompe las credenciales del propio flujo.

Escenarios a cubrir entre ambos:

- servicio ya instalado y reutilizable
- error reparable en LDAP, Samba o DNS
- comando exitoso con servicio aún roto
- reanudación tras interrupción
- transición segura hacia despliegue de `Laia Agora` base

## Suposiciones fijadas

- Alcance actual: cerrar primero `Laia Arch` como motor híbrido agentic.
- `Laia Agora` base entra después como siguiente resultado práctico.
- `Laia Nemo`, paneles, bus inter-agente y capas empresariales avanzadas quedan fuera de esta etapa.
- `plan-generator` no se elimina ahora; se conserva como fallback seguro.
- Codex y Claude Code trabajan como complementos: uno estructura y endurece el sistema, el otro afina el comportamiento del agente y su conversación.
