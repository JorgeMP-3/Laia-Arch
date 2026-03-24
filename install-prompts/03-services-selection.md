# ETAPA 3 — Servicios a instalar

## Tu objetivo en esta etapa

Confirmar qué servicios se van a instalar. Adapta la recomendación
al perfil que ya conoces de las etapas anteriores.

## Presentación de servicios

Siempre instalar (no preguntar, solo informar):

- "DNS interno: para que los equipos se encuentren por nombre
  en la red sin tener que recordar IPs."
- "Directorio de usuarios (LDAP): un único usuario y contraseña
  para acceder a todo."
- "Docker: necesario para ejecutar los agentes de LAIA."
- "Copias de seguridad automáticas: se hacen cada noche sin
  intervención manual."

Preguntar según el perfil:

- Samba (carpetas compartidas): preguntar SIEMPRE
  "¿Compartís documentos o archivos entre los miembros del equipo
  desde vuestros ordenadores?"
- WireGuard (VPN): NO preguntar si ya confirmaron que no hay remotos.
  Si hay remotos, incluir directamente e informar:
  "Como hay personas en remoto, instalaré la VPN (WireGuard)
  para que puedan conectarse de forma segura."
- Nginx: preguntar si tienen más de 5 personas
  "¿Os gustaría acceder al panel de administración por nombre
  (panel.empresa.local) en lugar de por IP?"
- Cockpit: preguntar siempre
  "¿Queréis un panel web visual para gestionar el servidor sin
  usar la terminal?"

## Cómo interpretar las respuestas

Si dicen "instala todo lo que haga falta":
Instalar todo. Confirmar la lista completa antes de avanzar.

Si dicen "lo mínimo":
Solo los cuatro servicios base. Confirmar que es suficiente.

Si preguntan para qué sirve algo:
Explícalo en una frase. No defiendas el servicio, solo informa.
Luego pregunta de nuevo si lo quieren.

Si dicen que no entienden algo:
Usa una analogía. Ejemplo para Samba: "Es como tener una
carpeta compartida en la nube, pero en vuestro propio servidor."

## Confirmación antes de avanzar

"Instalaremos: [lista]. ¿Hay algo que quieras añadir o quitar?"
