# Laia Agora — Documento de arquitectura

> Fecha base: 2026-03-27 | Última revisión: 2026-03-27 (stack tecnológico completo confirmado)
> Estado: documento de diseño — Laia Agora como producto empresarial no está implementado.
> Este documento describe la arquitectura propuesta para la Fase 6 del roadmap (Bloque B).
> No debe iniciarse hasta que el Bloque A (Laia Arch como instalador) esté cerrado.
>
> Decisiones de stack confirmadas por el arquitecto: frontend (Next.js), API (tRPC),
> motor del agente (imagen openclaw extendida), bus inter-agente (HTTP directo con
> interfaz abstracta preparada para migración a Redis), base de datos (PostgreSQL),
> editor de documentos (TipTap), notificaciones Fase 1 (polling, migrable a WebSocket),
> mapping LDAP→roles (automático con fallback a miembro básico),
> provisión de usuarios (automática en primer login).
> Pendiente: integraciones Fase 5.

---

## 1. Qué es Laia Agora exactamente

Laia Agora es el espacio de trabajo operativo diario del equipo de la empresa.

Es una aplicación web autoalojada en el servidor propio que reúne en un solo
lugar:

- gestión de proyectos y tareas
- base de conocimiento y documentos
- comunicación interna por proyecto
- interacción directa con el agente Laia Agora

### Qué no es

- No es un SaaS: los datos no salen del servidor de la empresa.
- No es un asistente de IA conversacional de propósito general.
- No es una interfaz pública: solo accesible desde la red local y la VPN.
- No es un clon de ninguna herramienta externa: se integra con la infraestructura
  propia (LDAP, Samba, WireGuard) que el resto del ecosistema ya gestiona.

### Por qué no simplemente usar ClickUp, Notion o herramientas externas

| Diferencia                | Herramientas externas      | Laia Agora                                      |
| ------------------------- | -------------------------- | ----------------------------------------------- |
| Datos                     | En servidores de terceros  | En el servidor propio                           |
| Autenticación             | Cuenta propia por servicio | Misma cuenta LDAP de la empresa                 |
| Integración con el agente | No existe                  | El agente opera dentro del workspace            |
| Escalada a Arch           | Imposible                  | El agente puede pedir operaciones privilegiadas |
| Control total             | No                         | Sí                                              |

---

## 2. Usuarios y roles

### Quién usa Agora

Todo el personal de la empresa con acceso a la red local o VPN.

### Autenticación

Los usuarios se autentican con sus credenciales LDAP existentes. No hay
cuentas separadas para Agora. El mismo usuario y contraseña que usan para
la red, Samba y el resto de servicios.

### Roles en Agora

Los roles de Agora se derivan de los grupos LDAP definidos durante la
instalación. No hay grupos hardcodeados — el sistema mapea los grupos LDAP
existentes a permisos de Agora.

Ejemplo de mapeo típico (los nombres reales dependen de cada empresa):

| Grupo LDAP (ejemplo) | Rol en Agora  | Qué puede hacer                               |
| -------------------- | ------------- | --------------------------------------------- |
| `admin`              | Administrador | Todo, incluida configuración de la plataforma |
| `gerencia`           | Editor global | Ver y editar cualquier proyecto y documento   |
| `creativos`          | Miembro       | Ver y editar proyectos asignados              |
| `comerciales`        | Miembro       | Ver y editar proyectos asignados              |
| `cuentas`            | Miembro       | Ver y editar proyectos asignados              |

**Nota:** Los nombres "creativos", "comerciales", "cuentas" son ejemplos.
Los grupos reales se crean dinámicamente en el instalador según lo que la
empresa define en la conversación de instalación.

### Identidades especiales

**Administrador de la plataforma**: usuario LDAP con grupo `admin` (o el
grupo designado en configuración). Gestiona proyectos, usuarios, integraciones.

**Laia Arch**: no tiene cuenta de usuario en Agora. Actúa desde fuera del
producto para instalar, actualizar y reconfigurar la plataforma cuando el
administrador lo solicita.

**Agente Laia Agora**: tiene cuenta de servicio interna con permisos de
escritura sobre tareas, documentos y notificaciones. No tiene acceso root
ni puede modificar configuración del servidor.

---

## 3. Módulos del producto

### Módulo 1 — Gestión de proyectos y tareas

**Problema que resuelve:** el equipo necesita saber quién hace qué, en qué
estado está y cuándo debe estar listo, sin depender de herramientas de pago
externas.

**Qué incluye:**

- Proyectos como contenedor principal de trabajo
- Tareas con subtareas, asignación, estado, fecha límite y prioridad
- Vista tablero (kanban por estado) y vista lista
- Comentarios por tarea
- Adjuntos vinculados a archivos de Samba (referencia por ruta, no duplicado)

**Datos que maneja:**

- `Proyecto`: id, nombre, descripción, miembros, fechas, estado
- `Tarea`: id, proyecto, título, descripción, asignado, estado, fecha, prioridad, subtareas, comentarios

**Interacción con otros módulos:**

- Los documentos de la base de conocimiento pueden vincularse a proyectos
- El agente puede actualizar estados y añadir comentarios

---

### Módulo 2 — Base de conocimiento

**Problema que resuelve:** el conocimiento de la empresa vive en emails,
chats y documentos dispersos. Agora centraliza el conocimiento interno
con estructura.

**Qué incluye:**

- Documentos organizados por área o proyecto
- Edición rich text con TipTap (experiencia tipo Notion — el equipo es no técnico,
  no se usa markdown puro)
- Historial de versiones básico (quién editó y cuándo)
- Etiquetas y búsqueda por contenido

**Datos que maneja:**

- `Documento`: id, título, contenido (markdown), autor, proyecto vinculado,
  etiquetas, fechas de creación y última edición, versiones

**Interacción con otros módulos:**

- Vinculable a proyectos y tareas
- El agente puede crear y actualizar documentos como parte de automatizaciones

---

### Módulo 3 — Comunicación interna

**Problema que resuelve:** las conversaciones sobre proyectos se pierden en
WhatsApp o email. Agora las centraliza junto al trabajo que las origina.

**Qué incluye:**

- Hilos de conversación vinculados a proyectos o canales temáticos
- Menciones a usuarios (`@usuario`)
- Notificaciones internas por cambios relevantes (tarea asignada, comentario nuevo)
- En Fase 1: sin chat en tiempo real, solo hilos asincrónicos

**Datos que maneja:**

- `Hilo`: id, proyecto o canal, participantes, mensajes
- `Mensaje`: id, hilo, autor, contenido, fecha, menciones

**Interacción con otros módulos:**

- El agente puede publicar actualizaciones en hilos (resúmenes, alertas)
- Las notificaciones se generan desde cambios en tareas y documentos

---

### Módulo 4 — Panel del agente

**Problema que resuelve:** el agente Laia Agora necesita un punto de
interacción dentro del workspace, separado de la mensajería externa.

**Qué incluye:**

- Interfaz de conversación con el agente dentro de la aplicación web
- El agente puede responder preguntas sobre el estado de proyectos y tareas
- El agente puede ejecutar acciones: crear tareas, actualizar estados, notificar
- Registro de acciones realizadas por el agente (trazabilidad)

**Datos que maneja:**

- `Conversación con agente`: historial de mensajes, acciones ejecutadas
- `Acción del agente`: tipo, parámetros, resultado, timestamp

**Interacción con otros módulos:**

- Lee y escribe en los módulos de tareas, documentos y comunicación
- No tiene acceso directo a configuración de red, LDAP o servicios del sistema

---

## 4. Arquitectura técnica propuesta

> Decisiones de stack confirmadas marcadas con ✓.
> Decisiones pendientes marcadas con ⏳ — ver sección "Preguntas para el arquitecto".

### Visión general

```
[Red local / VPN]
      │
      ▼
[Nginx :80]  ── /agora/ ──►  [agora-frontend]  ──►  [agora-api (tRPC)]
                              (Next.js)                    │
                                                ┌──────────┼────────────┐
                                                ▼          ▼            ▼
                                         [agora-db ⏳] [agora-agent] [LDAP :389]
                                                       (openclaw img)
                                                            │
                                                    [Bus inter-agente]
                                                     HTTP directo (F1)
                                                    interfaz abstracta
                                                  (preparada para Redis)
                                                      │            │
                                               [Laia Arch]    [Laia Nemo]
```

### Servicios Docker

| Servicio         | Imagen base                                  | Propósito                          | Estado       |
| ---------------- | -------------------------------------------- | ---------------------------------- | ------------ |
| `agora-frontend` | Next.js (Node.js)                            | UI web de la aplicación            | ✓ confirmado |
| `agora-api`      | Node.js + tRPC                               | API tipada compartida con frontend | ✓ confirmado |
| `agora-db`       | `postgres:16`                                | Base de datos principal            | ✓ confirmado |
| `agora-agent`    | `ghcr.io/openclaw/openclaw:latest` extendida | Motor del agente Laia Agora        | ✓ confirmado |

**Frontend — Next.js (✓ confirmado)**
Next.js es el stack del ecosistema. Menos fricción de incorporación, coherente
con el resto del TypeScript del proyecto.

**API — tRPC (✓ confirmado)**
tRPC sobre Next.js + TypeScript garantiza tipos compartidos entre frontend y
backend sin capa de generación de código. Reduce errores de contrato en los
límites frontend/API.

**Motor del agente — imagen openclaw extendida (✓ confirmado)**
El servicio `agora-agent` reutiliza la imagen `ghcr.io/openclaw/openclaw:latest`
ya desplegada en `agora-01/02/03` y se extiende para el producto completo.
No se construye un motor de agente propio. Los detalles de qué partes del
gateway openclaw se reutilizan se determinarán en la implementación de Fase 2.

### Volúmenes

```
/srv/laia-agora/
├── config/          # openclaw.json (ya existe)
├── workspace/       # workspace del agente (ya existe)
├── templates/       # plantillas del ecosistema (ya existe)
├── db/              # datos de PostgreSQL (nuevo)
└── uploads/         # archivos adjuntos subidos por usuarios (nuevo)
```

### Red interna Docker

- Todos los servicios en una red Docker interna (`agora-net`)
- Solo `agora-frontend` expuesto al host (al puerto local, vía Nginx)
- `agora-db` no expuesto fuera de la red Docker
- `agora-agent` solo accesible por `agora-api`

### Integración LDAP

- **Autenticación**: bind LDAP con credenciales del usuario en cada inicio de sesión
- **Autorización**: los grupos LDAP del usuario determinan su rol en Agora
- **Sincronización**: al arrancar `agora-api`, sincroniza usuarios y grupos desde LDAP
- **Librería recomendada**: `ldapts` (Node.js, ya disponible en el ecosistema)

### Nginx

El proxy Nginx (ya instalado por `nginx-01`) recibe una nueva location:

```nginx
location /agora/ {
    proxy_pass http://127.0.0.1:<puerto-frontend>/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

Acceso: `http://<ip-servidor>/agora/` desde red local o VPN.

### Nuevos pasos en plan-generator (Bloque B, Fase 6)

Estos pasos se añaden al `plan-generator.ts` cuando se abra el Bloque B.
No modificar el Bloque A.

| Step ID    | Fase | Qué hace                                        |
| ---------- | ---- | ----------------------------------------------- |
| `agora-04` | 6    | Despliega PostgreSQL con volumen persistente    |
| `agora-05` | 6    | Despliega `agora-api` y `agora-frontend`        |
| `agora-06` | 6    | Configura location `/agora/` en Nginx y recarga |
| `agora-07` | 6    | Inicializa el schema de la base de datos        |
| `agora-08` | 6    | Sincronización inicial LDAP → usuarios Agora    |

---

## 5. Relación con el ecosistema

### Arch → Agora

- Instala toda la infraestructura de Agora durante la instalación del servidor
- Puede reconfigurar Agora (actualizar imagen, cambiar configuración) cuando el
  administrador lo solicita post-instalación
- Gestiona las credenciales de base de datos sin exponerlas al agente

### Agora → Arch

- El agente Laia Agora puede solicitar operaciones privilegiadas a Laia Arch:
  - Crear o desactivar usuarios LDAP
  - Cambiar permisos de carpetas Samba
  - Reiniciar servicios
- Laia Arch siempre requiere aprobación humana antes de ejecutar cualquier
  operación privilegiada solicitada por Agora
- Comunicación vía bus inter-agente (ver sección siguiente)

### Bus inter-agente (✓ confirmado — diseño con interfaz abstracta)

**Decisión de Fase 1:** HTTP directo entre contenedores en la red Docker interna.

**Decisión de diseño permanente:** el bus inter-agente debe vivir detrás de
una interfaz abstracta propia desde el primer día. Ningún módulo de Agora,
Arch o Nemo llama directamente a `fetch()` o a una librería de transporte
concreta — todos llaman a la interfaz del bus.

Esto garantiza que migrar de HTTP directo a Redis (u otro mecanismo) en el
futuro sea un cambio localizado en un solo módulo (la implementación del bus)
y no una reescritura de cómo se comunican los agentes entre sí.

Estructura prevista:

```
src/bus/
├── index.ts          # interfaz pública: send(), subscribe(), request()
├── http-transport.ts # implementación Fase 1: HTTP directo entre contenedores
└── redis-transport.ts # implementación futura: sin cambios en consumidores
```

La interfaz define el contrato (tipos de mensajes, garantías de entrega, manejo
de errores). La implementación concreta se inyecta en el arranque según
configuración.

### Nemo → Agora

- Laia Nemo actúa como interfaz externa del ecosistema
- Los empleados remotos interactúan con Nemo (WhatsApp, Telegram, Slack)
- Nemo puede consultar y actualizar Agora mediante la API de Agora con un
  token de servicio
- Agora no conoce a Nemo directamente: Nemo consume la API como cualquier
  cliente autorizado
- Agora no envía notificaciones externas directamente — las delega a Nemo

### Agente Laia Agora (límites operativos)

Puede hacer:

- Leer y actualizar tareas, proyectos, documentos
- Publicar en hilos de comunicación
- Enviar notificaciones internas
- Ejecutar scripts de automatización aprobados dentro del workspace

No puede hacer:

- Ejecutar comandos root
- Modificar configuración de red, firewall o VPN
- Crear o eliminar usuarios LDAP sin aprobación
- Instalar paquetes del sistema
- Acceder a carpetas administrativas de Samba fuera de su scope

---

## 6. Fases de construcción

> Prerrequisito: el Bloque A (Laia Arch como instalador) debe estar cerrado
> antes de empezar cualquiera de estas fases.

### Fase 1 — MVP de valor mínimo

**Criterio de cierre:** el equipo puede usar Agora como sustituto real de al
menos una herramienta externa (Trello, Notion, ClickUp) para gestión de tareas
y documentos.

Incluye:

- Autenticación LDAP funcional
- Módulo de tareas: crear, asignar, cambiar estado, comentar
- Módulo de documentos: crear y editar en markdown
- UI básica funcional: lista de proyectos, tablero kanban, editor de documentos (TipTap)
- Notificaciones internas por polling simple (sin WebSocket — ver nota más abajo)
- Nginx proxy configurado y accesible desde red local y VPN
- Sin agente integrado aún

> **Nota sobre notificaciones:** en Fase 1 se usa polling simple (el cliente consulta
> al servidor periódicamente). Misma filosofía que el bus inter-agente: simple ahora,
> migrable cuando haya demanda real. El cambio a WebSocket está previsto y debe ser
> localizado: quien lo construya debe diseñar la capa de notificaciones detrás de una
> interfaz abstracta propia, igual que el bus, para que el transporte sea reemplazable
> sin tocar la lógica que consume notificaciones.

No incluye:

- Comunicación en tiempo real
- Panel del agente
- Métricas

---

### Fase 2 — Integración del agente

**Criterio de cierre:** el agente puede leer el estado de proyectos y tareas
y actuar sobre ellos desde una interfaz dentro de Agora.

Incluye:

- Panel de interacción con el agente en la UI
- El agente lee y actualiza tareas y documentos
- Registro de acciones del agente (trazabilidad)
- Notificaciones internas básicas (tarea asignada, comentario nuevo)

---

### Fase 3 — Comunicación interna

**Criterio de cierre:** el equipo puede conversar sobre proyectos dentro de
Agora sin depender de WhatsApp o email.

Incluye:

- Hilos de conversación por proyecto
- Menciones a usuarios
- Notificaciones push dentro de la app (websocket o polling)
- El agente puede publicar actualizaciones en hilos

---

### Fase 4 — Escalada a Nemo

**Criterio de cierre:** los empleados remotos pueden consultar y actualizar
tareas desde mensajería externa (WhatsApp, Telegram) a través de Nemo.

Incluye:

- API de Agora accesible por Nemo con token de servicio
- Protocolo de escalada Nemo → Agora → Arch definido e implementado
- Bus inter-agente operativo (HTTP directo con interfaz abstracta, confirmado)

---

### Fase 5 — Capas empresariales avanzadas

**Criterio de cierre:** Agora ofrece visibilidad de rendimiento del equipo y
conectores a sistemas externos relevantes para la empresa.

Incluye (pendiente de definición del arquitecto):

- Métricas y dashboards por proyecto
- Integraciones con sistemas de campañas o CRM
- Políticas operativas por rol empresarial

---

## 7. Decisiones del arquitecto

### Confirmadas ✓

| #   | Decisión                 | Respuesta                                                                                                                                |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Stack de frontend        | **Next.js** — ya es el stack del ecosistema, menos fricción                                                                              |
| 2   | API                      | **tRPC** — coherente con Next.js + TypeScript, reduce errores de contrato                                                                |
| 3   | Motor del agente         | **Imagen openclaw extendida** — reutilizar `agora-agent`, no construir motor propio                                                      |
| 4   | Base de datos            | **PostgreSQL**                                                                                                                           |
| 5   | Editor de documentos     | **TipTap sobre ProseMirror** — el equipo es no técnico, necesita experiencia tipo Notion                                                 |
| 6   | Notificaciones en Fase 1 | **Polling simple** — migrable a WebSocket detrás de interfaz abstracta cuando haya demanda real                                          |
| 7   | Mapping LDAP → roles     | **Automático** — el grupo LDAP determina el rol; si el grupo no tiene mapeo definido, el usuario entra como miembro con permisos básicos |
| 8   | Provisión de usuarios    | **Automática en primer login** — el perfil se crea al primer inicio de sesión con credenciales LDAP                                      |
| 9   | Bus inter-agente         | **HTTP directo (Fase 1) con interfaz abstracta** — migración a Redis localizada en un módulo                                             |

### Pendientes ⏳

10. **Integraciones de Fase 5** ⏳ — ¿Qué sistemas externos concretos necesita
    la empresa conectar (CRM, campañas, facturación)? Se responde cuando se llegue
    a la Fase 5.

---

## Stack tecnológico confirmado

Referencia rápida para cualquier agente o desarrollador que vaya a construir Agora.
Todas las decisiones aquí son definitivas salvo indicación explícita del arquitecto.

| Capa                    | Tecnología                          | Notas                                                      |
| ----------------------- | ----------------------------------- | ---------------------------------------------------------- |
| Frontend                | **Next.js**                         | Stack del ecosistema                                       |
| API                     | **tRPC**                            | Tipos compartidos frontend/backend, sobre Next.js          |
| Base de datos           | **PostgreSQL 16**                   | Contenedor `agora-db`, volumen en `/srv/laia-agora/db/`    |
| Editor de documentos    | **TipTap** (sobre ProseMirror)      | Experiencia tipo Notion para usuarios no técnicos          |
| Motor del agente        | **Imagen openclaw extendida**       | Contenedor `agora-agent`, misma imagen que el gateway base |
| Autenticación           | **LDAP bind** (`ldapts`)            | Sin cuentas propias de Agora; mismo usuario del servidor   |
| Roles                   | **Automático desde grupos LDAP**    | Sin configuración manual; fallback a miembro básico        |
| Provisión de usuarios   | **Automática en primer login**      | No requiere alta previa por el administrador               |
| Notificaciones Fase 1   | **Polling simple**                  | Migrable a WebSocket detrás de interfaz abstracta          |
| Bus inter-agente Fase 1 | **HTTP directo entre contenedores** | Interfaz abstracta preparada para Redis                    |
| Proxy                   | **Nginx** (ya instalado)            | Location `/agora/` → `agora-frontend`                      |
| Red                     | **Red local + VPN (WireGuard)**     | Sin exposición directa a internet                          |
| Contenedores            | **Docker Compose**                  | Red interna `agora-net`; solo frontend expuesto al host    |

**Pendiente de confirmar:** integraciones de Fase 5 (CRM, campañas, facturación).

---

## Apéndice — Estado del despliegue base hoy

Lo que ya existe tras una instalación completa con Laia Arch:

| Recurso                  | Ruta / Puerto                          | Estado                 |
| ------------------------ | -------------------------------------- | ---------------------- |
| Docker Compose           | `/opt/laia-agora/docker-compose.yml`   | Existente              |
| Variables de entorno     | `/opt/laia-agora/.env`                 | Existente              |
| Configuración gateway    | `/srv/laia-agora/config/openclaw.json` | Existente              |
| Workspace del agente     | `/srv/laia-agora/workspace/`           | Existente              |
| Templates del ecosistema | `/srv/laia-agora/templates/`           | Existente              |
| Gateway openclaw         | `http://127.0.0.1:18789`               | Arrancado y verificado |
| Bridge openclaw          | `http://127.0.0.1:18790`               | Arrancado              |
| UI del producto          | —                                      | No existe              |
| Base de datos            | —                                      | No existe              |
| API propia               | —                                      | No existe              |
