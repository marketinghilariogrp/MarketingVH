# MarketingVH · Sistema de gestión de equipo

Tareas, asistencia, eventos y reportes del equipo de marketing, con Google Sheets + Apps Script.

## Roles

| Rol | Quién | Puede |
|---|---|---|
| `admin` | Master general | Todo: usuarios, configuración, aprobar, reabrir tareas aprobadas |
| `coordinador` | CM / Social Media Manager | Crear, asignar, editar, devolver y cancelar tareas; aprobar si `Config.coordinador_puede_aprobar = SI` |
| `colaborador` | Audiovisual, diseño, CM, trafficker | Ver solo sus tareas, empezarlas y enviarlas a revisión |
| `practicante` | Renzo, Abigail | Registrar sus horas, ver sus tareas y el calendario |

Estados de una tarea: `pendiente → en_progreso → revision → aprobada` (también `cancelada`).
El colaborador nunca puede aprobar su propia tarea.

## Estructura

```
src/
  appsscript.json   Configuración del proyecto (zona horaria, web app)
  Main.gs           doGet() y carga inicial
  Auth.gs           Login con correo + PIN, sesiones, roles
  Usuarios.gs       Alta, edición y PIN de usuarios
  Tareas.gs         Crear, editar y mover tareas de estado
  Utils.gs          Lecturas en bloque, caché, bloqueo, log
  Setup.gs          Instalación inicial y recuperación del PIN admin
  Index.html, Estilos.html, App.html   Interfaz
```

Los datos viven en un Google Sheet aparte (`MarketingVH · Datos`), creado por `setup()`.
Las reglas editables (pesos, jornada, áreas, feriados) están en la hoja **Config**.

## Instalación (una sola vez)

1. Activar la API de Apps Script: https://script.google.com/home/usersettings
2. `clasp login` con la cuenta marketing@hilariogrp.com
3. `clasp create --type standalone --title "MarketingVH" --rootDir src`
4. `clasp push`
5. `clasp open-script` → ejecutar la función `setup` → aceptar permisos → copiar el PIN del administrador del registro de ejecución.
6. Implementar → Nueva implementación → Aplicación web (ejecutar como: yo; acceso: cualquier persona). Compartir la URL con el equipo.

Para publicar cambios: `clasp push` y luego actualizar la implementación existente
(`clasp deploy -i <ID_IMPLEMENTACION>`) para que la URL no cambie.

Si el administrador olvida su PIN: ejecutar `resetearPinAdmin` desde el editor.

## Módulos (barra lateral)

| Módulo | Archivos | Qué hace |
|---|---|---|
| Inicio | `Dashboard.gs`, `VistaInicio.html` | KPIs, alertas automáticas, horas por función, producción, equidad de eventos |
| Calendario | `Agenda.gs`, `VistaEventos.html` | Mes a mes (ene 2026 – dic 2027): eventos, entregas de tareas, agenda de contenido, feriados |
| Producción | `Tareas.gs`, `VistaTareas.html` | Tablero con marca, campaña, pieza, tipo, responsable, prioridad, entrega y estado |
| Solicitudes | `Solicitudes.gs` | Pedidos internos; la coordinación los asigna (se vuelven tareas) o rechaza |
| Eventos y rotación | `Eventos.gs` | Personal por evento (función, zona/etapa, horario), conteo mensual/anual, índice de equidad, sugerencias |
| Horas | `Horas.gs`, `VistaHoras.html` | Registro por función (practicantes incluidos), capacidad y % de uso |
| Contenido | `Agenda.gs`, `VistaMarketing.html` | Enlaces a parrillas (Google Sheets) y agenda: publicaciones, grabaciones, entregables |
| Pauta Meta Ads | `Meta.gs` | Corte diario 6:00 p. m. de las 4 cuentas, correo con resumen y alertas de variación |

Automatizaciones (`instalarAutomatizaciones()`): `pautaDiaria` 18:00, `alertasDiarias` 08:00, `copiaSemanal` domingos.

## Pendiente

- Redes sociales (crecimiento de comunidad, alcance, interacción): requiere IDs de páginas/cuentas de Instagram.
- Leer el contenido de las parrillas (hoy solo se enlazan): requiere conocer su formato.
- Asistencia (entrada/salida, horas extra, saldos) y finanzas.
