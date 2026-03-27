# LAIA — Explicación detallada del proyecto

## Qué es LAIA

LAIA es un ecosistema privado de agentes IA para empresas.

No es un asistente personal de consumo.
No es un SaaS público.
No es una demo de agentes.

Es infraestructura interna para operar una empresa sobre un servidor propio.

## Idea central

Todo el ecosistema vive en un único servidor físico Ubuntu controlado por la empresa.

La seguridad no depende de repartir componentes en múltiples máquinas.
La seguridad depende de separar capas, privilegios, accesos, canales y ámbitos de acción.

## Los tres agentes del ecosistema

### Laia Arch

Rol:

- agente fundador
- nivel 0
- máximo privilegio técnico sobre el sistema
- instalador, arquitecto y reparador de la infraestructura

Propósito:

- configurar el servidor desde cero
- modificar infraestructura crítica con aprobación humana
- auto-desactivarse cuando termina la instalación
- reactivarse solo desde el servidor físico, con contraseña, cuando sea necesario

### Laia Agora

Rol:

- agente de operaciones diarias
- nivel 1
- centro de trabajo del equipo

Propósito:

- ser el espacio principal de trabajo de la empresa
- gestionar proyectos, tareas, documentos y comunicación interna
- funcionar como un espacio integrado tipo ClickUp + Notion + Figma
- operar dentro de la red local y VPN
- correr en Docker, aislado del host

### Laia Nemo

Rol:

- agente de acceso externo
- nivel 2
- interfaz de acceso rápido desde cualquier lugar

Propósito:

- dar acceso desde cualquier dispositivo y ubicación en cualquier momento
- exponer capacidades con privilegios mínimos y controlados
- atender desde mensajería y web
- escalar cuando la tarea supera su nivel de privilegio
- correr en Docker, aislado del host

## Qué hace diferente a LAIA

La diferencia no es que use un LLM.

La diferencia es que el ecosistema está organizado por niveles de privilegio y responsabilidades reales:

- Arch construye la infraestructura
- Agora opera la empresa
- Nemo expone acceso controlado al exterior

Eso convierte a LAIA en arquitectura operativa, no en simple chatbot.

## Qué es Laia Arch específicamente

`Laia Arch` es el primer componente del ecosistema y también su condición de posibilidad.

Sin `Laia Arch`, no existe una forma coherente de crear la infraestructura base.

Su trabajo es:

- entender la empresa mediante conversación
- entender el estado real del servidor mediante escaneo
- decidir cómo dejar la infraestructura preparada
- ejecutar cambios del sistema con herramientas reales
- verificar que todo funciona
- reparar lo que falle
- dejar el ecosistema en perfecto estado

## Los tres modos de instalación de Laia Arch

Laia Arch tiene tres modos de instalación diseñados para distintas capacidades de IA y distintas necesidades.

La existencia de tres modos responde a un problema real:
no todas las IAs tienen la misma capacidad de razonamiento,
y no todas las instalaciones necesitan el mismo nivel de personalización.

### Automático (code: `tool-driven`)

La IA hace un número mínimo de preguntas y ejecuta directamente con herramientas predefinidas.

Propósito:

- instalar LAIA en su configuración base sin personalización por empresa
- diseñado para IAs con capacidad de razonamiento limitada
- o para cuando ya sabes exactamente lo que quieres y no necesitas adaptación

Comportamiento:

- la IA ejecuta un conjunto de tools predefinidas
- no requiere razonar sobre qué preguntar ni planificar a medida
- el resultado es una instalación funcional pero genérica

### Asistido (code: `guided`)

La IA sigue una guía fija de preguntas en orden fijo.

Propósito:

- instalaciones estándar predecibles
- el camino es siempre el mismo

Comportamiento:

- las preguntas vienen de los archivos `install-prompts/00-06.md`
- el orden no cambia
- la IA no necesita decidir qué preguntar ni cuándo

### Adaptativo (code: `adaptive`)

La IA adapta la instalación según la empresa y lo que va descubriendo.

Propósito:

- instalaciones a medida para cada empresa
- diseñado para IAs con capacidad real de razonamiento
- primera instalación, situaciones complejas o empresas con necesidades específicas

Comportamiento actual (estado real del código):

- la IA conversa de forma adaptativa
- extrae una `InstallerConfig` estructurada
- el plan se genera por código de forma determinista a partir de esa config
- la IA no gobierna la ejecución en tiempo real

Comportamiento objetivo (visión del proyecto):

- la IA observa el sistema, decide, ejecuta, verifica y repara sobre la marcha
- el plan determinista queda como fallback de seguridad, no como camino principal

Esta transición es la tensión técnica central del proyecto y la prioridad actual del roadmap.

## Laia Arch después de instalar

Cuando Laia Arch termina la instalación:

- se auto-desactiva
- queda en reposo por defecto
- solo puede reactivarse desde el servidor físico, con una contraseña específica
- cuando está activo, puede configurar todo el sistema y la red con aprobación humana

Laia Arch post-instalación tendrá su propia UI de control del servidor.
Esa UI será una versión mejorada de la interfaz actual de OpenClaw.
Permite gestionar el servidor, crear nuevas herramientas para la empresa y administrar el ecosistema.

Esta UI está en la lista de trabajo futuro — no está implementada todavía.

## Laia Agora en detalle

Laia Agora es el centro de trabajo diario del equipo.

La visión es un espacio integrado que reúne lo que hoy hacen herramientas separadas:

- gestión de proyectos y tareas (tipo ClickUp)
- documentos y base de conocimiento (tipo Notion)
- colaboración creativa (tipo Figma)
- comunicación interna del equipo

Corre en Docker, aislado del host, con acceso solo a los recursos que se le compartan explícitamente.

Hoy existe como despliegue base funcional: el instalador lo levanta, lo verifica y deja corriendo en el puerto 18789.
El ecosistema completo de Agora como producto empresarial terminado está pendiente.

## Laia Nemo en detalle

Laia Nemo es la capa de acceso rápido desde cualquier lugar.

Propósito:

- empleados accediendo desde fuera de la oficina en cualquier momento
- acceso desde WhatsApp, Telegram, Slack, web pública
- privilegios mínimos, sin acceso a configuración ni operaciones críticas
- escala a Agora si la tarea lo requiere

Corre en Docker, en una red completamente aislada de Agora.
No hay comunicación directa entre contenedores — todo pasa por el bus inter-agente.

Estado actual: existe como plantilla de workspace y concepto. Producción estimada Q3 2026.

## Qué no debe ser Laia Arch

No debe ser:

- un formulario con salida a bash
- un "wizard bonito" sobre un script fijo
- una IA que solo redacta un plan y luego desaparece
- un sistema que se rompe ante el primer imprevisto

## Qué debe ser realmente

Debe ser un agente instalador de infraestructura.

Eso significa:

1. parte de un objetivo, no de una receta cerrada
2. observa el estado real del sistema antes de actuar
3. decide la estrategia según lo observado
4. usa herramientas de verdad para ejecutar cambios
5. verifica el resultado de cada cambio
6. intenta resolver los fallos por sí mismo
7. escala al humano solo cuando hace falta
8. conserva contexto técnico completo durante todo el proceso

## Proceso correcto de instalación

### 1. Escaneo

El agente descubre todo lo descubrible sin molestar al administrador:

- hardware
- red
- puertos
- software instalado
- servicios activos
- conflictos y riesgos

### 2. Conversación

El agente pregunta solo lo que no puede inferir:

- nombre y tipo de empresa
- roles y usuarios
- si hay remotos
- exigencias de seguridad
- necesidades de compliance
- servicios realmente necesarios

### 3. Razonamiento

El agente transforma ese contexto en decisiones técnicas:

- qué instalar
- qué no instalar
- en qué orden
- con qué configuración
- qué riesgos hay

### 4. Ejecución supervisada

El agente ejecuta con autonomía, pero dentro de HITL:

- el humano aprueba decisiones significativas
- no hace falta aprobar cada línea trivial
- sí hay que aprobar cambios con impacto real

### 5. Reparación

Si algo falla:

- el agente diagnostica
- prueba soluciones
- vuelve a verificar
- continúa cuando queda resuelto

### 6. Cierre

La instalación no termina cuando acaban los comandos.
Termina cuando el estado final ha sido verificado.

## Filosofía técnica

El proyecto debe combinar dos cosas:

- inteligencia operativa del agente
- disciplina de infraestructura reproducible

Por eso la forma correcta de evolucionarlo no es destruir lo existente.
La forma correcta es mover el centro de gravedad:

- antes: manda el plan fijo
- después: manda el agente
- el plan fijo queda como red de seguridad

## Qué papel juegan Codex y Claude Code

En este proyecto, Codex y Claude Code no son "usuarios" del sistema.
Son herramientas de construcción del propio proyecto.

Su papel es:

- analizar el repo real
- mantener alineada la visión con la implementación
- proponer cambios concretos
- escribir código
- refactorizar arquitectura
- mantener documentación viva del estado del sistema

## Frase guía del proyecto

LAIA debe convertirse en una infraestructura de agentes empresariales donde `Laia Arch` actúe como un informático experto en forma de agente, capaz de construir, verificar y reparar el servidor de la empresa con supervisión humana y contexto completo.
