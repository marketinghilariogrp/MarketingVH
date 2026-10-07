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
- Publicar: `clasp push` y luego
  `clasp update-deployment AKfycbxC0JaVmHVuQJ78YXGwEpIAYHhY-v7x3nQzhRLDbi5bvK-P_76Bq81SKrnqGNoIHyWQ -d "<descripción>"`
  para mantener la misma URL:
  https://script.google.com/macros/s/AKfycbxC0JaVmHVuQJ78YXGwEpIAYHhY-v7x3nQzhRLDbi5bvK-P_76Bq81SKrnqGNoIHyWQ/exec
- Ojo: `clasp create`/`clone` sobrescriben `src/appsscript.json`; revisar que siga en America/Lima.
- Verificar sintaxis antes de subir: concatenar `src/*.gs` y pasar `node --check` (igual con los `<script>` de `src/*.html`).
- Columnas nuevas: agregarlas SIEMPRE al final de su lista en `ESQUEMA` (Utils.gs); `setup()` las migra.
- Interfaz: `App.html` es el núcleo (estado `S`, `api`, `modal`, `barras`, barra lateral); cada `Vista*.html` registra
  sus pantallas en `VISTAS`. Rol extra `practicante` (Renzo, Abigail).
- NO se conecta la API de Meta Ads (decisión del usuario). La pauta se lee de sus Google Sheets (Fuentes_pauta),
  reconociendo columnas por encabezado (`COLUMNAS_PAUTA` en Pauta.gs).
- Equipo actual (oct 2026): Rodrigo, Jefferson (coord.), Gabriela (coord.), Blue, Antony, Renzo y Abigail (practicantes),
  Chris, Cesi. Fran, Jorge, Challs y Henz ya no están. Marcas: Nexo, Academia VH Business, Vyc, Pagape, Marca Personal, EDE.
- Monedas de pauta: solo Nexo pauta en soles (PEN); el resto en dólares (USD). La cuenta «CA-Huacachina del Norte»
  es de Nexo. NUNCA convertir entre monedas (decisión del usuario): cada monto lleva el símbolo de su cuenta (S/ o $)
  y los totales que mezclan monedas se muestran por separado (`totales_().monedas`, `montoTexto_`).
- Horario: L–V 9:00–18:30, sáb 9:00–13:00; fuera de eso es sobretiempo (Sobretiempo.gs).
- Pruebas: lógica del servidor con stubs en Node (vm) y la interfaz con un `prueba-local.html` que simula google.script.run.
- Notificaciones: la hoja «Requerimiento de Diseño 2026» (Config.hoja_requerimientos) dispara alEditarRequerimientos
  (trigger instalable onEdit). Gabriela recibe todo; Blue además Nexo/V&C; Chris además Academia VHB, Marca Personal,
  Ede 2.0, VH CONSULTING (Config.notif_requerimientos_*). Recordatorios de agenda: trigger cada 5 min + correo.
- Agenda personal (privado = SI) solo la ve quien la creó; lo del equipo lo ven todos. Borrado lógico: estado
  'eliminado' (agenda/eventos) y 'eliminada' (tareas). Tareas aprobadas pueden ir al histórico (archivada = SI).
- Horas: hoja Asistencia (ingreso/salida por día). Sobretiempo compensable solo si ese día la persona tenía evento
  asignado. Practicantes: 25 h/semana. Chris y Cesi no cubren eventos ni marcan horas (Config.excluidos_*).
- Informes = solo pauta. El crecimiento de redes va en Redes sociales → Reporte (exporta a Google Sheets).
- Logística por evento (Logistica.gs): catálogo en hoja Inventario (buscador), ítems en hoja Logistica; los alquilados
  se incluyen siempre. Exporta a Google Sheet (carpeta «MarketingVH · Logística», mismo archivo al regenerar).
- Las hojas/columnas nuevas del ESQUEMA se crean solas al primer uso (hoja_ llama a prepararHoja_).
- Tareas: estado 'pausada' (motivo en pausa_motivo). Cada cambio de estado se guarda en Tareas_historial; el admin ve
  inicio, trabajo efectivo y pausas (solo en horario laboral) y el historial de cada tarea.
