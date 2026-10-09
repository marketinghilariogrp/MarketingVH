/**
 * Pendientes del día (checklist por prioridad, sin hora) para el admin y la coordinación.
 * - Cada persona ve y edita su propia lista.
 * - El admin además ve y edita la lista de cada coordinador (y les puede dejar pendientes).
 * - Un coordinador puede dejarle un pendiente al admin (solo qué es y la prioridad); ve la confirmación
 *   de lo que envió, pero nunca la lista del admin.
 * - Cualquier pendiente se puede pasar al calendario como agenda personal de su dueño.
 * - Lo que no se marcó como hecho pasa solo al día siguiente (al día actual al abrir la lista); fecha_original guarda
 *   el día en que se anotó.
 */

const PRIORIDADES_PEND = ['alta', 'media', 'baja'];

/** Listas que u puede ver: la suya y, si es admin, la de cada coordinador activo (menos Config.excluidos_pendientes). */
function listasPendientes_(u) {
  if (u.rol !== 'admin') return [u];
  return [u].concat(usuarios_().filter(x => x.rol === 'coordinador' && x.activo === 'SI' && !excluidoDe_(x, 'excluidos_pendientes')));
}

function puedeVerLista_(u, usuarioId) {
  return listasPendientes_(u).some(x => x.id === usuarioId);
}

/** Admin al que se le envían los pendientes de la coordinación. */
function adminPendientes_() {
  const a = usuarios_().find(x => x.rol === 'admin' && x.activo === 'SI');
  if (!a) throw new Error('No hay un administrador activo.');
  return a;
}

function pendCliente_(p, nombres) {
  return {
    id: p.id, usuario_id: p.usuario_id, fecha: p.fecha, titulo: p.titulo, detalle: p.detalle, prioridad: p.prioridad,
    hecho: p.hecho === 'SI', creado_por: p.creado_por, de: p.creado_por !== p.usuario_id ? nombres[p.creado_por] || '' : '',
    en_calendario: !!p.agenda_id, viene_de: p.fecha_original || ''
  };
}

/** Pendiente que u puede editar (de una lista que ve). */
function pendienteEditable_(u, id) {
  const p = leerTabla_('Pendientes').find(x => x.id === id && x.estado !== 'eliminado');
  if (!p || !puedeVerLista_(u, p.usuario_id)) throw new Error('Pendiente no encontrado.');
  return p;
}

/**
 * Pendientes de la lista usuarioId entre desde y hasta (una semana). Antes pasa a hoy lo que quedó sin hacer.
 * Para la coordinación incluye «enviados»: lo que dejó al admin, solo con su estado.
 */
function getPendientes(token, usuarioId, desde, hasta) {
  const u = sesion_(token);
  exigirGestor_(u);
  usuarioId = usuarioId || u.id;
  if (!puedeVerLista_(u, usuarioId)) throw new Error('No puedes ver esta lista.');
  if (!esFecha_(desde) || !esFecha_(hasta)) throw new Error('Rango no válido.');
  const hoy = hoy_();
  const nombres = mapaNombres_();
  pasarSinHacerAHoy_(usuarioId, hoy);
  const todos = leerTabla_('Pendientes').filter(p => p.estado !== 'eliminado');
  const deLista = todos.filter(p => p.usuario_id === usuarioId);
  return {
    hoy: hoy,
    listas: listasPendientes_(u).map(x => ({ id: x.id, nombre: x.id === u.id ? 'Mis pendientes' : x.nombre })),
    items: deLista.filter(p => p.fecha >= desde && p.fecha <= hasta).map(p => pendCliente_(p, nombres)),
    enviados: u.rol === 'admin' ? [] : todos.filter(p => p.creado_por === u.id && p.usuario_id !== u.id)
      .sort((a, b) => b.creado.localeCompare(a.creado)).slice(0, 20)
      .map(p => ({ id: p.id, titulo: p.titulo, prioridad: p.prioridad, enviado: p.creado, para: nombres[p.usuario_id] || '', hecho: p.hecho === 'SI' }))
  };
}

/** Mueve a hoy los pendientes de días anteriores que no se marcaron como hechos. */
function pasarSinHacerAHoy_(usuarioId, hoy) {
  const atrasado = p => p.usuario_id === usuarioId && p.estado !== 'eliminado' && p.hecho !== 'SI' && p.fecha < hoy;
  if (!leerTabla_('Pendientes').some(atrasado)) return;
  conLock_(() => {
    leerTabla_('Pendientes').filter(atrasado).forEach(p => {
      Object.assign(p, { fecha_original: p.fecha_original || p.fecha, fecha: hoy, actualizado: ahora_() });
      escribirFila_('Pendientes', p);
    });
  });
}

/** Todas las listas: lo usa el trigger diario para que el cambio de día no dependa de abrir la sección. */
function pasarPendientesSinHacer() {
  const hoy = hoy_();
  Array.from(new Set(leerTabla_('Pendientes').filter(p => p.hecho !== 'SI' && p.estado !== 'eliminado' && p.fecha < hoy)
    .map(p => p.usuario_id))).forEach(id => pasarSinHacerAHoy_(id, hoy));
}

/**
 * Crea o edita un pendiente. d: { id?, usuario_id, fecha, titulo, detalle, prioridad }.
 * Si un coordinador se lo deja al admin (d.para_admin), solo cuentan el título y la prioridad.
 */
function guardarPendiente(token, d) {
  const u = sesion_(token);
  exigirGestor_(u);
  d = d || {};
  const prioridad = opcion_(d.prioridad || 'media', PRIORIDADES_PEND, 'Prioridad no válida.');
  const titulo = texto_(d.titulo, 200);
  if (!titulo) throw new Error('Escribe el pendiente.');
  const ahora = ahora_();
  const nombres = mapaNombres_();
  let aOtro = false;
  const r = conLock_(() => {
    if (d.id) {
      const p = pendienteEditable_(u, d.id);
      const fecha = texto_(d.fecha, 10) || p.fecha;
      if (!esFecha_(fecha)) throw new Error('Fecha no válida.');
      Object.assign(p, { titulo: titulo, detalle: texto_(d.detalle, 1000), prioridad: prioridad, fecha: fecha, actualizado: ahora });
      escribirFila_('Pendientes', p);
      return pendCliente_(p, nombres);
    }
    let destino, fecha, detalle;
    if (d.para_admin && u.rol !== 'admin') {
      destino = adminPendientes_().id;
      fecha = hoy_();
      detalle = '';
    } else {
      destino = d.usuario_id || u.id;
      if (!puedeVerLista_(u, destino)) throw new Error('No puedes agregar pendientes a esta persona.');
      fecha = texto_(d.fecha, 10);
      detalle = texto_(d.detalle, 1000);
      if (!esFecha_(fecha)) throw new Error('Elige el día.');
    }
    const p = { id: uuid_(), usuario_id: destino, fecha: fecha, titulo: titulo, detalle: detalle, prioridad: prioridad,
      hecho: 'NO', creado_por: u.id, creado: ahora, actualizado: ahora, completado: '', agenda_id: '', estado: 'activo' };
    agregarFila_('Pendientes', p);
    if (destino !== u.id) {
      aOtro = true;
      notificar_([destino], 'pendiente', u.nombre + ' te dejó un pendiente',
        titulo + ' · prioridad ' + prioridad + ' · ' + fmtFechaHora_(fecha, '') + (detalle ? ' · ' + detalle : ''), '', '');
    }
    log_(u.id, 'crear_pendiente', p.id, (nombres[destino] || '') + ': ' + titulo);
    return pendCliente_(p, nombres);
  });
  // Un pendiente para otra persona le llega por correo enseguida (sin esperar al trigger de cada minuto).
  if (aOtro) { try { enviarCorreosNotificaciones(); } catch (e) { console.log('Correo de pendiente: ' + e.message); } }
  return r;
}

function marcarPendiente(token, id, hecho) {
  const u = sesion_(token);
  exigirGestor_(u);
  return conLock_(() => {
    const p = pendienteEditable_(u, id);
    Object.assign(p, { hecho: hecho ? 'SI' : 'NO', completado: hecho ? ahora_() : '', actualizado: ahora_() });
    escribirFila_('Pendientes', p);
    return pendCliente_(p, mapaNombres_());
  });
}

function eliminarPendiente(token, id) {
  const u = sesion_(token);
  exigirGestor_(u);
  conLock_(() => {
    const p = pendienteEditable_(u, id);
    Object.assign(p, { estado: 'eliminado', actualizado: ahora_() });
    escribirFila_('Pendientes', p);
    log_(u.id, 'eliminar_pendiente', p.id, p.titulo);
  });
  return true;
}

/**
 * Pasa un pendiente al calendario como agenda personal (privada) de su dueño, con hora y recordatorio opcionales.
 */
function pendienteACalendario(token, id, d) {
  const u = sesion_(token);
  exigirGestor_(u);
  d = d || {};
  const hora = texto_(d.hora, 5);
  const recordatorio = d.recordatorio_min === '' || d.recordatorio_min == null ? ''
    : opcion_(String(d.recordatorio_min), RECORDATORIOS, 'Recordatorio no válido.');
  if (hora && !esHora_(hora)) throw new Error('Hora no válida.');
  if (recordatorio !== '' && !hora) throw new Error('Para poner un recordatorio indica la hora.');
  return conLock_(() => {
    const p = pendienteEditable_(u, id);
    const fecha = texto_(d.fecha, 10) || p.fecha;
    if (!esFecha_(fecha)) throw new Error('Fecha no válida.');
    const recordarEn = momentoRecordatorio_(fecha, hora, recordatorio);
    const a = { id: uuid_(), fecha: fecha, hora: hora, titulo: p.titulo, tipo: 'Pendiente personal', marca: '', campana: '',
      responsable_id: p.usuario_id, estado: 'pendiente', detalle: p.detalle, origen: 'pendiente:' + p.id,
      creado_por: p.usuario_id, actualizada: ahora_(), privado: 'SI', recordatorio_min: recordatorio,
      recordar_en: recordarEn, recordado: recordarEn && recordarEn <= ahora_() ? 'SI' : 'NO' };
    agregarFila_('Agenda', a);
    Object.assign(p, { agenda_id: a.id, fecha: fecha, actualizado: ahora_() });
    escribirFila_('Pendientes', p);
    log_(u.id, 'pendiente_calendario', p.id, fecha + ' ' + hora);
    return pendCliente_(p, mapaNombres_());
  });
}
