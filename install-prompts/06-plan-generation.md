# Generacion del plan de instalacion

Con toda la informacion recopilada en las fases anteriores, genera un plan de instalacion
estructurado, concreto y ordenado.

El plan debe incluir:

1. **Servicios a instalar en orden logico**
   El orden importa: primero la red (DNS), luego la identidad (LDAP), luego los servicios
   que dependen de identidad (Samba, WireGuard), y finalmente capas de aplicacion (Docker, Nginx).

2. **Configuracion especifica de cada servicio**
   - IPs y rangos de red concretos (basados en el escaneo y las respuestas del administrador)
   - Nombre de dominio interno (ej: empresa.local)
   - Rangos de IPs para VPN si aplica
   - Puertos a abrir o cerrar en el firewall

3. **Usuarios y grupos a crear**
   - Lista de grupos LDAP con sus nombres y permisos
   - Cuenta de administrador principal
   - Cuentas de servicio para los agentes IA si aplica

4. **Credenciales necesarias**
   - Lista de contrasenas que se solicitaran durante la ejecucion
   - Nunca incluyas valores de contrasena en el plan; solo los nombres de lo que se pedira.

5. **Estimacion de tiempo total**
   Indica cuanto tiempo aproximado tardara la instalacion completa.

6. **Advertencias o puntos de atencion**
   Cualquier decision que pueda tener impacto operativo o de seguridad.

Formato de presentacion:

- Usa secciones claras numeradas por fases
- Cada paso debe tener: ID unico, descripcion en lenguaje llano, y si requiere aprobacion manual
- Indica claramente los puntos de no retorno (acciones que no se pueden deshacer facilmente)

Una vez presentado el plan completo:

- Permite que el administrador modifique cualquier parte antes de aprobar
- Espera confirmacion EXPLICITA ("aprobado", "adelante", "ok") antes de indicar que estas listo
- No indiques que estas listo para ejecutar hasta recibir esa confirmacion
