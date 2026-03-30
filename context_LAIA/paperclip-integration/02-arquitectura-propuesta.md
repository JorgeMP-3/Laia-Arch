# Arquitectura propuesta para la integración de Paperclip

## Nivel 1: Paperclip como herramienta de desarrollo (inmediato)

En el corto plazo, Paperclip debe entenderse como herramienta de desarrollo y
orquestación interna, no como infraestructura base de producción.

Eso significa:

- se despliega aparte del stack principal de LAIA
- no participa en el instalador de `Laia Arch`
- no sustituye al gateway actual de `Laia Agora`
- no toma control de aprobaciones técnicas del host

Su función inmediata sería servir como laboratorio de coordinación multiagente
para validar tres hipótesis:

1. si el modelo de tickets/issues mejora la organización de trabajo entre
   agentes
2. si los heartbeats encajan con sesiones persistentes de OpenClaw/LAIA
3. si la trazabilidad y gobernanza de Paperclip aportan valor real frente al
   stack actual

En este nivel, el beneficio es exploratorio. El coste de equivocarse debe ser
bajo, así que el despliegue tiene que ser lateral y prescindible.

## Nivel 2: Paperclip como bus inter-agente en Bloque B (futuro)

En Bloque B, Paperclip podría actuar como **control plane de coordinación de
trabajo** entre agentes, siempre que no se le confunda con el runtime que
ejecuta las capacidades reales de LAIA.

La lectura correcta sería esta:

- Paperclip organiza agentes, tareas, aprobaciones y seguimiento
- OpenClaw/LAIA sigue ejecutando las sesiones, tools y acciones reales
- `Laia Arch` conserva el plano privilegiado del host
- `Laia Agora` y `Laia Nemo` siguen siendo productos/capas de LAIA

Esto lo convierte más en una capa de coordinación que en un bus de sistema en
sentido estricto.

Si más adelante se adopta en serio, Paperclip podría asumir:

- asignación y seguimiento de trabajo entre agentes
- trazabilidad multiagente persistente
- aprobaciones de negocio y de estrategia
- gobernanza de estructura organizativa

Pero no debería asumir:

- instalación del host
- operación privilegiada de infraestructura
- aprobación técnica de cambios del sistema
- propiedad conceptual de `Arch`, `Agora` o `Nemo`

La condición para este nivel es fuerte: primero debe cerrarse Bloque A y luego
decidir si Paperclip complementa o complica el bus previsto hoy para `Agora`.

## Diagrama de componentes (placeholder en texto)

```text
                        [ Operador humano / equipo ]
                                   |
                                   v
                      [ Paperclip UI + REST API ]
                                   |
                                   v
                  [ adapter: openclaw_gateway (WebSocket) ]
                                   |
                                   v
                     [ OpenClaw / LAIA gateway :18789 ]
                                   |
                  +----------------+----------------+
                  |                                 |
                  v                                 v
        [ sesiones / agent method ]        [ tools / routing / auth ]
                  |                                 |
                  +----------------+----------------+
                                   |
                                   v
                         [ Agentes de LAIA ]
                    Agora / Nemo / otros agentes

   [ Laia Arch ]
   plano privilegiado del host
   fuera de Paperclip
   con aprobaciones técnicas propias
```

Interpretación del diagrama:

- Paperclip controla la coordinación del trabajo
- el adaptador `openclaw_gateway` es la costura técnica
- el gateway de OpenClaw/LAIA sigue siendo el punto de entrada a sesiones y
  ejecución
- `Laia Arch` permanece fuera de esa cadena porque pertenece al plano
  privilegiado del sistema

La integración futura no debe convertir a Paperclip en dueño del host.

## Cambios necesarios en el stack actual

### Cambios necesarios para un POC futuro

- desplegar Paperclip como servicio separado
- añadir su base de datos propia
- configurar el adaptador oficial `openclaw_gateway`
- decidir qué agentes de LAIA serán visibles para Paperclip
- fijar una frontera explícita entre aprobaciones de negocio y aprobaciones
  técnicas

### Cambios que no deben hacerse en la fase inmediata

- no modificar el instalador de Bloque A
- no cambiar el camino actual que deja `Laia Agora` base operativa en `18789`
- no sustituir el gateway de OpenClaw/LAIA
- no mover a Paperclip la lógica de verificación activa o rescate
- no reescribir la arquitectura de `Laia Agora` antes de validar el valor real
  del POC

### Costura técnica prevista

La única costura futura que conviene dejar documentada ahora es:

`Paperclip -> adapter openclaw_gateway -> gateway WebSocket de OpenClaw/LAIA -> método agent`

Según el adaptador oficial, esa integración ya contempla:

- `url` del gateway `ws://` o `wss://`
- autenticación por `authToken` o headers
- estrategia de `sessionKey`
- `payloadTemplate`
- espera de resultado mediante `agent.wait`

Eso permite integrar Paperclip sin entregarle control sobre el host ni exigir
que LAIA exponga una API pública nueva solo para este experimento.
