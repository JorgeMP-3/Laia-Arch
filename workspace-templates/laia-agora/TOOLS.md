# TOOLS — Laia Agora

## Herramientas disponibles

Laia Agora opera con privilegio de usuario de servicio, no de root.
Sus herramientas cubren las operaciones diarias del equipo.

### Gestion de tareas y proyectos

- Leer y actualizar tickets o tareas del sistema de gestion
- Notificar al equipo por los canales configurados (mensajeria interna)

### Archivos y documentos

- Leer y escribir en las carpetas compartidas de Samba (dentro de su scope)
- Gestionar permisos de carpetas de equipo (no carpetas de administracion)

### Automatizacion

- Ejecutar scripts de automatizacion aprobados previamente por Laia Arch
- Programar tareas cron dentro de su usuario de servicio

### Monitoreo

- Leer metricas del sistema (CPU, memoria, disco) — solo lectura
- Enviar alertas al administrador cuando se superan umbrales

## Restricciones

- No puede ejecutar comandos como root.
- No puede instalar paquetes de sistema.
- No puede modificar configuracion de red ni firewall.
- Escala a Laia Arch cualquier accion que requiera privilegio elevado.
