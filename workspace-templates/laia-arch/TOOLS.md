# TOOLS DISPONIBLES — LAIA ARCH

## Sistema
- get_system_info: obtiene el estado actual del servidor (hw, red, servicios, advertencias)
- check_port_available: verifica si un puerto TCP/UDP está libre y qué proceso lo ocupa
- check_service_status: comprueba si un servicio systemd está active, inactive o not-installed
- read_file: lee archivos de configuración bajo /etc/ o /srv/
- write_file: escribe o sobreescribe archivos de configuración (rutas /etc/, /srv/, /home/laia-arch/)
- check_internet: verifica conectividad a internet y mide latencia

## Servicios
- install_package: instala paquetes apt con aprobación HITL del administrador
- enable_service: habilita e inicia un servicio systemd (enable + start)
- configure_ufw: añade o elimina reglas en el firewall UFW
- add_apt_repository: añade un repositorio externo apt con su clave GPG (necesario para Docker)
- configure_sysctl: aplica un parámetro del kernel via sysctl y lo persiste en /etc/sysctl.conf

## Usuarios LDAP
- create_ldap_user: crea un usuario en OpenLDAP con su rol (creativos/cuentas/comerciales)
- create_ldap_group: crea un grupo posixGroup en OpenLDAP
- add_user_to_group: añade un usuario como memberUid a un grupo LDAP existente
- verify_ldap_user: verifica que un usuario existe en LDAP y devuelve sus grupos

## Samba
- create_samba_share: crea carpeta compartida en Samba con permisos por grupo
- register_samba_user: registra un usuario en la base de datos smbpasswd
- verify_samba_share: verifica que un share de Samba es accesible localmente

## Red
- configure_hostname: establece el hostname del servidor y la entrada FQDN en /etc/hosts
- configure_wireguard_peer: genera claves WireGuard para un usuario remoto y añade su peer
- add_dns_record: añade un registro A al archivo de zona BIND9 y recarga el servidor DNS

## Credenciales
- generate_and_store_password: genera contraseña segura, la almacena cifrada y devuelve solo el ID

## Verificación
- verify_dns_resolution: verifica que un hostname resuelve correctamente vía DNS local
- verify_service_chain: verifica el estado de todos los servicios LAIA de una vez
- run_backup_test: ejecuta el script de backup manualmente y devuelve el tamaño del directorio

## Restricciones de uso

- Nunca reveles ni muestres contraseñas en output; usa generate_and_store_password y pasa el ID.
- write_file solo acepta rutas bajo /etc/, /srv/ o /home/laia-arch/ — rechaza cualquier otra.
- configure_sysctl solo acepta claves de kernel de la lista permitida (ip_forward, etc.).
- install_package y configure_ufw requieren aprobación HITL antes de ejecutarse.
- Ante cualquier fallo con retryable: true, reintenta una vez antes de informar al administrador.
