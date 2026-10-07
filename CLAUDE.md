# MarketingVH — notas para Claude

Sistema de gestión del equipo de marketing (Google Sheets + Apps Script). La especificación original
está en `Sistema-gestion-equipo.pdf` (Descargas del usuario); el README resume roles, estructura y fases.

- Idioma: todo en español (interfaz, mensajes de error, commits, respuestas al usuario).
- Zona horaria: Lima, Perú (`America/Lima` en `src/appsscript.json`).
- El equipo usa Gmail personales → login con correo + PIN (hash + token en CacheService).
  Solo marketing@hilariogrp.com es cuenta de la empresa y es la dueña del script y del Sheet de datos.
- Roles: `admin` (master), `coordinador` (asigna y aprueba tareas; `Config.coordinador_puede_aprobar = SI`),
  `colaborador` (8 personas: audiovisual, diseño gráfico, CM, trafficker).
- Reglas: permisos y cálculos siempre en el servidor; lecturas con un solo getValues() por hoja;
  escrituras y log_ dentro de conLock_; nunca borrar filas; reglas editables en la hoja Config.
- Publicar: `clasp push` y luego `clasp deploy -i <ID>` para mantener la misma URL.
- Verificar sintaxis antes de subir: concatenar `src/*.gs` y pasar `node --check`.
