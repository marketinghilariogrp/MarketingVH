# MarketingVH · Sistema de gestión de equipo

Gestión del equipo de marketing de VH Holding (producción, eventos, horas, sobretiempo, contenido, redes e informes),
con Google Sheets + Apps Script.

## Roles

| Rol | Quién | Puede |
|---|---|---|
| `admin` | Master general (marketing@hilariogrp.com) | Todo: usuarios, compensaciones de sobretiempo, crear parrillas, reabrir tareas aprobadas |
| `coordinador` | Jefferson, Gabriela | Asignar, editar, devolver, aprobar y cancelar tareas; eventos; aprobar sobretiempo; redes e informes |
| `colaborador` | Rodrigo, Blue, Antony, Chris, Cesi | Sus tareas, solicitudes, horas y horas extra; ver calendario y eventos |
| `practicante` | Renzo, Abigail | Igual que colaborador; registran sus horas en «Mis horas» |

Estados de una tarea: `pendiente → en_progreso → revision → aprobada` (también `cancelada`).

## Módulos (barra lateral)

| Módulo | Archivos | Qué hace |
|---|---|---|
| Inicio | `Dashboard.gs`, `VistaInicio.html` | KPIs, alertas automáticas, horas por función, producción, equidad de eventos |
| Calendario | `Agenda.gs`, `VistaEventos.html` | Mes a mes (ene 2026 – dic 2027): eventos, entregas, publicaciones de parrillas, agenda, feriados |
| Producción | `Tareas.gs`, `VistaTareas.html` | Tablero con marca, campaña, pieza, tipo, responsable, prioridad, entrega y estado |
| Solicitudes | `Solicitudes.gs` | Pedidos internos; la coordinación los asigna (se vuelven tareas) o rechaza |
| Eventos y rotación | `Eventos.gs` | Personal por evento, conteo mensual, índice de equidad e historial anual persona × mes |
| Horas | `Horas.gs`, `VistaHoras.html` | Registro por función, capacidad según horario y % de uso |
| Sobretiempo | `Sobretiempo.gs`, `VistaHoras.html` | Horas extra fuera del horario, aprobación, compensaciones y saldo para RR. HH. |
| Contenido y parrillas | `Parrillas.gs`, `VistaMarketing.html` | Un Google Sheet de parrilla por marca, sincronizado cada hora con la agenda |
| Redes sociales | `Redes.gs`, `VistaMarketing.html` | Métricas mensuales por cuenta (seguidores, alcance, visualizaciones, interacciones) |
| Informes | `Pauta.gs`, `VistaInformes.html` | Lee los Google Sheets de pauta; informe semanal/mensual/trimestral/anual con gráficos e interpretación; imprimible a PDF |

Horario laboral (Config `horario_laboral`): L–V 09:00–18:30, sáb 09:00–13:00. Feriados en Config `feriados`.

Automatizaciones (`instalarAutomatizaciones()`): `sincronizarFuentes` cada hora, `alertasDiarias` 08:00, `copiaSemanal` domingos.

## Estructura

Los datos viven en un Google Sheet aparte (`MarketingVH · Datos`), creado por `setup()`; las reglas editables están
en la hoja **Config**. `setup()` también aplica las migraciones pendientes (propiedad `MIGRACION`).
Las parrillas se crean en la carpeta de Drive `MarketingVH · Parrillas`.

## Instalación y publicación

1. `clasp login` con marketing@hilariogrp.com (requiere la API de Apps Script activada).
2. `clasp push`, luego en el editor ejecutar `setup` (y `instalarAutomatizaciones` una vez).
3. Publicar sin cambiar la URL: `clasp update-deployment <ID> -d "<descripción>"` (ID en `CLAUDE.md`).

Si el administrador olvida su PIN: ejecutar `resetearPinAdmin` desde el editor.
