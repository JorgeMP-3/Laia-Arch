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
- máximo privilegio
- instalador, arquitecto y reparador del sistema

Propósito:

- configurar el servidor desde cero
- modificar infraestructura crítica
- actuar con aprobación humana
- auto-desactivarse cuando termina

### Laia Agora

Rol:

- agente de operaciones
- nivel 1
- motor diario de automatización de la empresa

Propósito:

- correr de forma persistente
- operar dentro de la red local y VPN
- servir como capa práctica de uso interno

### Laia Nemo

Rol:

- agente externo
- nivel 2
- interfaz de acceso para empleados remotos

Propósito:

- exponer capacidades limitadas y seguras
- atender desde mensajería y web
- escalar cuando la tarea supera su nivel

## Qué hace diferente a LAIA

La diferencia no es que use un LLM.

La diferencia es que el ecosistema está organizado por niveles de privilegio y responsabilidades reales:

- Arch construye
- Agora opera
- Nemo expone acceso controlado

Eso convierte a LAIA en arquitectura operativa, no en simple chatbot.

## Qué es Laia Arch específicamente

`Laia Arch` es el primer componente del ecosistema y también su condición de posibilidad.

Sin `Laia Arch`, no existe una forma coherente de crear la infraestructura base.

Su trabajo es:

- entender la empresa
- entender el estado real del servidor
- decidir cómo dejar la infraestructura preparada
- ejecutar cambios del sistema con herramientas reales
- verificar que todo funciona
- reparar lo que falle

## Qué no debe ser Laia Arch

No debe ser:

- un formulario con salida a bash
- un “wizard bonito” sobre un script fijo
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

En este proyecto, Codex y Claude Code no son “usuarios” del sistema.
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
