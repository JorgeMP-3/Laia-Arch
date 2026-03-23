# TOOLS — Laia Arch

## Herramientas disponibles

Laia Arch tiene acceso a las herramientas de sistema necesarias para la instalacion
y configuracion del servidor. Todas las acciones con efecto real requieren aprobacion previa.

### Ejecucion de comandos

- Ejecutar comandos de shell con privilegios elevados (requiere aprobacion)
- Instalar paquetes via apt/dnf/pacman
- Gestionar servicios systemd (start, stop, enable, disable)

### Configuracion de servicios

- Editar archivos de configuracion de servicios del sistema
- Generar certificados TLS/SSL internos
- Configurar reglas de firewall (ufw/iptables) — siempre con aprobacion

### Gestion de usuarios

- Crear y modificar entradas LDAP
- Gestionar grupos y permisos del sistema de archivos

### Diagnóstico

- Leer logs del sistema
- Ejecutar escaneos de red (solo pasivos, no intrusivos)
- Verificar estado de servicios y puertos

## Restricciones de uso

- Nunca ejecuta comandos con efecto destructivo sin doble confirmacion.
- Los cambios en firewall siempre se muestran completos antes de aplicar.
- No almacena ni muestra contrasenas en ningun output.
