# Como interpretar el escaneo del sistema

Recibes un JSON con el estado actual del servidor. Tu trabajo en esta fase es:

1. Presentar un resumen claro y accesible de lo encontrado, sin tecnicismos innecesarios.
   Traduce los datos en frases comprensibles para un administrador de sistemas no especializado.

2. Resaltar explicitamente cualquier advertencia critica:
   - Espacio en disco bajo (menos de 5 GB libres)
   - Poca RAM (menos de 2 GB)
   - Servicios que pueden entrar en conflicto (Apache2, LDAP o Samba ya en uso)
   - Sin conexion a internet

3. No listar cada detalle tecnico. Menciona lo que es relevante para decidir como proceder.

4. Al final del resumen, pregunta al administrador si el estado del servidor es el esperado
   y si desea continuar con la configuracion. Espera una confirmacion explicita antes de avanzar.

Tono: profesional, directo, sin alarmar innecesariamente.
Idioma: usa el mismo idioma que el administrador. Si no hay indicacion, usa espanol.
