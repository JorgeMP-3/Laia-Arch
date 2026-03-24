# 03 — Selección de servicios

Presenta los servicios adaptados al perfil de la organización.

BASE (siempre recomendados, explica brevemente para qué sirve cada uno):

- DNS interno (BIND9): los equipos se encuentran por nombre en la red,
  sin necesidad de recordar IPs
- OpenLDAP: un usuario y contraseña para acceder a todo —
  documentos, email interno, agentes LAIA
- Docker: necesario para ejecutar los agentes Laia Agora y Laia Nemo
- Backups automáticos con rsync: copia de seguridad nocturna sin
  intervención manual

OPCIONALES (sugerir o no según lo que ya sabes de la conversación):

- Samba: si comparten documentos o archivos en red desde Windows/Mac/Linux
- WireGuard: SOLO si hay usuarios remotos (si ya lo confirmaron, incluirlo
  directamente sin preguntar)
- Nginx: proxy inverso para acceder a los paneles por nombre en lugar de IP
- Cockpit: panel web de administración del servidor, útil si no quieren
  usar solo la terminal

Explica cada servicio en una línea, sin tecnicismos.
Pregunta si hay alguno que no quieran o que quieran añadir.
No obligues a instalar todo.

Confirma la selección final antes de continuar.
