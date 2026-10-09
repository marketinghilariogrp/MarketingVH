/**
 * «Otros calendarios»: calendarios de Google a los que está suscrita la cuenta dueña del script
 * (marketing@hilariogrp.com), elegidos por nombre o ID en Config.calendarios_externos. Solo lectura.
 * Requiere el permiso de Calendar: ejecutar autorizarCalendarios() una vez desde el editor.
 */

const CACHE_OTROS_CAL = 300; // segundos

function calendariosExternos_() {
  const buscados = lista_('calendarios_externos');
  const todos = CalendarApp.getAllCalendars();
  const elegidos = [];
  const faltan = [];
  buscados.forEach(b => {
    const c = todos.find(x => x.getId() === b) || todos.find(x => normal_(x.getName()) === normal_(b));
    if (c && elegidos.indexOf(c) < 0) elegidos.push(c); else if (!c) faltan.push(b);
  });
  return { elegidos: elegidos, faltan: faltan, disponibles: faltan.length ? todos.map(c => c.getName()) : [] };
}

/** Eventos del mes de los otros calendarios. Solo admin y coordinación. */
function getOtrosCalendarios(token, mes, refrescar) {
  const u = sesion_(token);
  exigirGestor_(u);
  if (!/^\d{4}-\d{2}$/.test(String(mes))) throw new Error('Mes no válido.');
  const cache = CacheService.getScriptCache();
  const clave = 'otroscal_' + mes;
  if (!refrescar) {
    const guardado = cache.get(clave);
    if (guardado) return JSON.parse(guardado);
  }
  const ini = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)) - 1, 1);
  const fin = new Date(ini.getFullYear(), ini.getMonth() + 1, 1);
  const cals = calendariosExternos_();
  const eventos = [];
  const calendarios = cals.elegidos.map((c, i) => {
    const id = 'c' + i;
    c.getEvents(ini, fin).forEach(e => {
      const todoDia = e.isAllDayEvent();
      // En los eventos de todo el día la fecha de fin es el día siguiente (exclusiva).
      const termina = todoDia ? new Date(e.getEndTime().getTime() - 1) : e.getEndTime();
      eventos.push({
        cal: id, titulo: e.getTitle() || '(Sin título)', todo_dia: todoDia,
        inicio: fmt_(e.getStartTime(), 'yyyy-MM-dd HH:mm'), fin: fmt_(termina, 'yyyy-MM-dd HH:mm'),
        lugar: e.getLocation() || '', detalle: String(e.getDescription() || '').replace(/<[^>]+>/g, ' ').slice(0, 400)
      });
    });
    return { id: id, nombre: c.getName(), color: c.getColor() || '#888888' };
  });
  const r = { calendarios: calendarios, eventos: eventos, faltan: cals.faltan, disponibles: cals.disponibles, actualizado: ahora_() };
  const json = JSON.stringify(r);
  if (json.length < 90000) cache.put(clave, json, CACHE_OTROS_CAL);
  return r;
}

/** Ejecutar una vez desde el editor: concede el permiso de Calendar y muestra los calendarios de la cuenta. */
function autorizarCalendarios() {
  const todos = CalendarApp.getAllCalendars();
  console.log('Calendarios de la cuenta:\n' + todos.map(c => '- ' + c.getName() + '  (' + c.getId() + ')').join('\n'));
  const r = calendariosExternos_();
  console.log('Se mostrarán: ' + r.elegidos.map(c => c.getName()).join(', ') +
    (r.faltan.length ? '\nNo encontrados (revisa Config.calendarios_externos): ' + r.faltan.join(', ') : ''));
}
