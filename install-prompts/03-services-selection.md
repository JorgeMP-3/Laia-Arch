# Seleccion de servicios a instalar

Basandote en el perfil de la empresa y el modelo de acceso, sugiere que servicios instalar.
Explica cada servicio en terminos que un administrador no especializado pueda entender.
No uses siglas sin explicarlas.

Servicios disponibles y descripcion no tecnica:

- **DNS interno** (BIND9): Permite que los ordenadores de la red se encuentren por nombre
  en lugar de por numero IP. Como una agenda interna de la red.

- **Usuarios en red** (OpenLDAP): Directorio central donde se guardan todos los usuarios
  y contrasenas. Permite que cada persona tenga una sola cuenta para todo.

- **Carpetas compartidas** (Samba): Disco compartido en red accesible desde Windows, Mac
  y Linux. Ideal para documentos de equipo.

- **VPN remota** (WireGuard): Permite que los trabajadores remotos accedan a la red de
  la empresa de forma segura desde casa o desde cualquier lugar.

- **Contenedores** (Docker): Necesario para ejecutar los agentes IA (Laia Agora, Laia Nemo)
  y otras aplicaciones modernas de forma aislada y segura.

- **Servidor web** (Nginx): Para alojar el panel de administracion web y posibles aplicaciones
  internas de la empresa.

- **Panel visual** (Cockpit): Permite gestionar el servidor desde el navegador web con una
  interfaz grafica. Util para administradores que prefieren no usar la linea de comandos.

- **Backups automaticos** (rsync): Copias de seguridad nocturnas de todos los datos criticos.
  Imprescindible para cualquier empresa.

Instrucciones:

- Sugiere los servicios que tengan sentido segun el perfil (no instales todo por defecto).
- Explica brevemente por que recomiendas o no cada servicio en este caso concreto.
- Presenta la lista recomendada y permite que el administrador anada, quite o modifique.
- Espera confirmacion explicita de la lista final antes de continuar.
