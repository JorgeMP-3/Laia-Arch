# Decisión sobre la integración de Paperclip

## Decisión final (integrar / no integrar / posponer)

Decisión actual: **posponer**.

Motivo:

Paperclip parece valioso como capa futura de coordinación multiagente, pero no
es la prioridad correcta mientras LAIA siga cerrando Bloque A.

La integración no se rechaza por incompatibilidad técnica. Se pospone por orden
de prioridades y por necesidad de proteger el foco actual del proyecto:

- cerrar `Laia Arch` como instalador híbrido real
- consolidar `Laia Agora` base
- evitar duplicar prematuramente la arquitectura de Bloque B

Conclusión operativa:

- no integrar ahora en producción
- no tocar el instalador para acomodar Paperclip
- reevaluar más adelante como POC lateral apoyado en `openclaw_gateway`

## Fecha de revisión

Fecha propuesta de revisión: **2026-07-15**.

La fecha debe entenderse como punto de control posterior al cierre esperado de
Bloque A, no como compromiso automático de integración.

## Responsable

Responsable de la revisión: **arquitecto / responsable técnico de LAIA**.

Si en el futuro existe una distinción formal entre arquitectura de producto y
arquitectura de infraestructura, la decisión debería revisarse de forma
conjunta entre ambos roles.

## Condiciones que cambiarían la decisión

La decisión de `posponer` solo debería cambiar si se cumplen varias condiciones
a la vez:

### 1. Fase 4 cerrada

`Laia Agora` base debe estar funcionando de forma estable y verificada en el
stack actual.

### 2. Necesidad real de coordinación multiagente persistente

Debe existir una necesidad comprobable de:

- tickets multiagente
- heartbeats reanudables
- gobernanza de agentes
- trazabilidad superior a la que hoy da el stack existente

### 3. POC exitoso con `openclaw_gateway`

Debe existir una prueba aislada que confirme:

- conexión estable entre Paperclip y LAIA/OpenClaw
- preservación de sesiones
- separación correcta de responsabilidades
- ausencia de impacto negativo sobre el gateway y el flujo actual

### 4. No ruptura del modelo Arch/Agora/Nemo

La integración no debe degradar la arquitectura central del proyecto:

- `Laia Arch` sigue siendo el agente privilegiado del host
- `Laia Agora` sigue siendo el producto interno de trabajo
- `Laia Nemo` sigue siendo la capa de acceso externo

Si Paperclip obliga a diluir esa arquitectura o a subordinarla a su propio
modelo, la decisión debe mantenerse en `posponer` o pasar a `no integrar`.
