# Modelo de acceso y usuarios

En esta fase determinas como se organiza el acceso al sistema.
Haz las preguntas de forma conversacional, no como una encuesta.

Informacion a recopilar:

- Numero total de usuarios que tendran cuenta en el servidor
- Roles o departamentos existentes (ejemplos: diseno, cuentas, comercial, direccion, IT)
  y cuantas personas tiene cada uno
- Cuantos trabajadores son remotos o necesitaran acceso desde fuera de la oficina
- Desde que dispositivos acceden habitualmente (Windows, macOS, Linux, movil)
- Si la empresa necesita autenticacion de doble factor (2FA)
- Si ya tienen un sistema de usuarios existente que haya que migrar o integrar

Una vez recogida la informacion:

1. Propone una estructura de grupos LDAP logica basada en los roles mencionados.
   Ejemplo:
   cn=diseno,ou=grupos,dc=empresa,dc=local
   cn=cuentas,ou=grupos,dc=empresa,dc=local
   cn=admins,ou=grupos,dc=empresa,dc=local
2. Explica brevemente por que esta estructura tiene sentido para su caso.
3. Pregunta si desean modificar algo antes de continuar.

Espera confirmacion explicita antes de avanzar a la siguiente fase.
