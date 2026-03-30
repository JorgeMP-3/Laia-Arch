# Evaluación de Paperclip para LAIA

## ¿Qué aporta Paperclip que LAIA no tiene?

Paperclip aporta una capa de organización del trabajo multiagente que hoy no existe
como producto terminado dentro de LAIA.

Lo relevante no es que ejecute modelos mejor que OpenClaw, sino que ofrece un
**control plane** alrededor de los agentes:

- organigrama de agentes con cadena de mando explícita
- unidad de trabajo basada en tickets/issues
- heartbeats para ejecución periódica y reanudable
- presupuestos por agente y control de coste
- gobernanza empresarial con aprobaciones y revisiones
- trazabilidad operativa de tareas, decisiones y actividad
- separación clara entre capa de control y runtimes de ejecución

Esto encaja con el tipo de coordinación que Bloque B acabará necesitando si el
ecosistema crece más allá de un único agente principal por superficie.

Además, Paperclip ya contempla a OpenClaw como runtime externo mediante el
adaptador `openclaw_gateway`. Eso reduce el coste de una futura integración,
porque no obliga a reescribir el motor del agente ni a abandonar el gateway ya
existente.

## ¿Qué tiene LAIA que Paperclip no puede reemplazar?

Paperclip no reemplaza el núcleo diferencial de LAIA.

LAIA no es solo coordinación entre agentes. Es una arquitectura operativa por
niveles de privilegio:

- `Laia Arch` construye, verifica y repara la infraestructura
- `Laia Agora` es el espacio operativo interno
- `Laia Nemo` es la capa de acceso externo con privilegios mínimos

Ese diseño incluye capacidades que Paperclip no pretende cubrir:

- instalador real del host Ubuntu
- tools del sistema con impacto sobre red, LDAP, Samba, Docker, Nginx y WireGuard
- verificación activa tras cada acción importante
- flujo HITL técnico para operaciones sensibles
- persistencia de sesión orientada a instalación y rescate
- separación de privilegios entre host, red local, VPN y canales externos

Paperclip puede coordinar trabajo. No puede sustituir la función fundacional de
`Laia Arch` ni asumir la responsabilidad de instalar o mantener infraestructura
crítica con garantías equivalentes.

Tampoco sustituye por sí solo el diseño de producto de `Laia Agora`, que sigue
apuntando a una aplicación empresarial propia con identidad, módulos y contratos
internos definidos por el roadmap de LAIA.

## Riesgos de introducir una dependencia externa

Introducir Paperclip añade riesgos técnicos y estratégicos que conviene dejar
explícitos antes de convertirlo en parte del stack:

### Riesgo 1 — Abrir un frente antes de tiempo

El roadmap actual es claro: no abrir frentes nuevos antes de cerrar Bloque A,
es decir, `Laia Arch` como instalador híbrido real más `Laia Agora` base
operativa.

Si se introduce ahora como pieza operativa, Paperclip competiría por atención
con el cierre de Fase 4.

### Riesgo 2 — Duplicidad con el diseño previsto de Bloque B

`Laia Agora` ya tiene una arquitectura propuesta y el bus inter-agente previsto
hoy es HTTP directo con interfaz preparada para migración a Redis.

Si Paperclip se presenta como bus o control plane sin redefinir fronteras,
aparecen solapes:

- dos sitios posibles para tickets y coordinación
- dos modelos de aprobación
- dos lugares para la trazabilidad
- dos posibles centros de gobierno del trabajo

### Riesgo 3 — Complejidad operativa adicional

Paperclip no entra gratis en el sistema:

- despliegue adicional
- base de datos propia
- autenticación y llaves nuevas
- observabilidad y mantenimiento extra
- nueva superficie de fallo entre control plane y runtime real

Eso puede merecer la pena en Bloque B, pero no mientras LAIA sigue cerrando su
base operativa.

### Riesgo 4 — Mezclar aprobaciones de negocio con aprobaciones técnicas

Paperclip tiene aprobaciones orientadas a gobernanza de agentes y estrategia.
LAIA ya tiene aprobaciones técnicas para operaciones sensibles del sistema.

Si no se separan desde el principio, se introduce una ambigüedad peligrosa:
que una aprobación de negocio parezca autorizar una acción de infraestructura.

En LAIA eso no debe pasar. Las aprobaciones del host deben seguir bajo el
modelo técnico propio de OpenClaw/LAIA.

### Riesgo 5 — Dependencia de un proyecto externo en una capa sensible

Aunque Paperclip sea open source y autoalojable, sigue siendo una dependencia
externa para una parte delicada del ecosistema.

Eso obliga a evaluar:

- compatibilidad futura de versiones
- estabilidad real del adaptador `openclaw_gateway`
- coste de mantener la integración si divergen ambos proyectos
- impacto de basar una parte crítica de Bloque B en una pieza que no controla
  directamente LAIA

La dependencia puede ser razonable. Lo que no sería razonable es asumir que no
crea coste de integración a medio plazo.

## Veredicto: integrar o no integrar

Veredicto actual: **no integrar en producción ahora; posponer y reevaluar como
POC lateral cuando cierre Bloque A**.

La conclusión no es que Paperclip sea mala idea. Al contrario: conceptualmente
encaja mejor en Bloque B que en Bloque A, y el hecho de que ya pueda hablar con
OpenClaw mediante `openclaw_gateway` lo convierte en una opción seria para una
fase posterior.

Pero hoy LAIA todavía no tiene cerrada su prioridad principal:

- terminar `Laia Arch` como instalador híbrido real
- dejar `Laia Agora` base estable y verificada

Por tanto, la posición correcta ahora es:

- documentar la oportunidad
- definir una arquitectura de integración futura
- preparar criterios claros para un POC
- no convertir a Paperclip en pieza operativa del sistema antes de tiempo
