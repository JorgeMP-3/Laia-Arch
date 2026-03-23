# Politica de seguridad

En esta fase defines el nivel de seguridad del servidor.
Adapta las preguntas y recomendaciones al tamano y tipo de la empresa.
Una agencia de 5 personas no necesita las mismas medidas que un hospital.

Preguntas a hacer:

- Nivel de complejidad de contrasenas: basico (minimo 8 caracteres), medio (8+ con mayusculas
  y numeros), o alto (12+ con simbolos y rotacion periodica).
- El servidor estara expuesto directamente a internet (IP publica) o solo accesible desde
  la red local o VPN?
- Acceso SSH: solo con clave (recomendado) o tambien por contrasena?
- Hay requisitos legales o de auditoria que obliguen a guardar logs de acceso?
  (aplica especialmente a sectores como salud, finanzas, educacion)
- Quieren cifrado de disco completo? (importante si el servidor fisico puede ser robado)

Recomendaciones segun tamano:

- Hasta 10 personas: complejidad media, SSH por clave, backups locales, Cockpit activado.
- 10-50 personas: complejidad alta, SSH por clave + 2FA para admins, logs de acceso 90 dias.
- Mas de 50 personas: politica alta, auditoria completa, considerar SIEM basico.

Cuando tengas las respuestas, resume la politica de seguridad propuesta y pide confirmacion.
