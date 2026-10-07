/**
 * Notificaciones dentro de la plataforma (campana en la barra superior) y, para recordatorios, también por correo.
 * Fuentes:
 * - Hoja «Requerimiento de Diseño 2026»: cada cambio avisa a Gabriela y, según la pestaña, a Blue o a Chris
 *   (reglas en Config.notif_requerimientos_reglas). Trigger instalable alEditarRequerimientos.
 * - Recordatorios de la agenda: trigger revisarRecordatorios cada 5 minutos.
 */

const MINUTOS_AGRUPAR = 30; // cambios seguidos en el mismo requerimiento se juntan en una sola notificación

/**
 * Crea (o actualiza, si hay una sin leer con la misma clave reciente) una notificación por destinatario.
 * Llamar dentro de conLock_.
 */
function notificar_(usuarioIds, tipo, titulo, detalle, enlace, clave) {
  const ahora = ahora_();
  const limite = fmt_(new Date(Date.now() - MINUTOS_AGRUPAR * 60000), 'yyyy-MM-dd HH:mm:ss');
  const existentes = clave ? leerTabla_('Notificaciones').filter(n => n.clave === clave && n.leida !== 'SI' && n.actualizada >= limite) : [];
  const nuevas = [];
  Array.from(new Set(usuarioIds.filter(Boolean))).forEach(uid => {
    const n = existentes.find(x => x.usuario_id === uid);
    if (n) {
      Object.assign(n, { titulo: titulo, detalle: detalle, enlace: enlace || '', actualizada: ahora });
      escribirFila_('Notificaciones', n);
    } else {
      nuevas.push({ id: uuid_(), usuario_id: uid, fecha_hora: ahora, tipo: tipo, titulo: titulo, detalle: detalle,
        enlace: enlace || '', leida: 'NO', clave: clave || '', actualizada: ahora });
    }
  });
  agregarFilas_('Notificaciones', nuevas);
}

function listarNotificaciones(token) {
  const u = sesion_(token);
  return leerTabla_('Notificaciones').filter(n => n.usuario_id === u.id)
    .sort((a, b) => b.actualizada.localeCompare(a.actualizada)).slice(0, 100)
    .map(n => ({ id: n.id, tipo: n.tipo, titulo: n.titulo, detalle: n.detalle, enlace: n.enlace, leida: n.leida === 'SI', fecha: n.actualizada }));
}

function contarNotificaciones(token) {
  const u = sesion_(token);
  return leerTabla_('Notificaciones').filter(n => n.usuario_id === u.id && n.leida !== 'SI').length;
}

/** Marca como leídas las indicadas, o todas si ids está vacío. */
function marcarNotificaciones(token, ids) {
  const u = sesion_(token);
  ids = Array.isArray(ids) ? ids : [];
  conLock_(() => {
    leerTabla_('Notificaciones')
      .filter(n => n.usuario_id === u.id && n.leida !== 'SI' && (!ids.length || ids.indexOf(n.id) >= 0))
      .forEach(n => { n.leida = 'SI'; escribirFila_('Notificaciones', n); });
  });
  return true;
}

/* ---------- Hoja de requerimientos de diseño ---------- */

/** Destinatarios según la pestaña: siempre los de notif_requerimientos_todos, más los de la regla que coincida. */
function destinatariosRequerimiento_(pestana) {
  const cfg = config_();
  const nombres = lista_('notif_requerimientos_todos');
  const p = normal_(pestana);
  String(cfg.notif_requerimientos_reglas || '').split(';').map(s => s.trim()).filter(String).forEach(regla => {
    const i = regla.lastIndexOf(':');
    const pestanas = regla.slice(0, i).split(',').map(normal_);
    if (pestanas.indexOf(p) >= 0) regla.slice(i + 1).split(',').forEach(n => nombres.push(n.trim()));
  });
  return nombres.map(usuarioPorNombre_).filter(Boolean).map(x => x.id);
}

/** Resumen legible del requerimiento (bloque de filas que empieza donde hay «Fecha de solicitud»). */
function resumenRequerimiento_(sh, fila) {
  const ultimaCol = Math.min(sh.getLastColumn(), 40);
  const cab = sh.getRange(1, 1, Math.min(3, sh.getLastRow()), ultimaCol).getValues();
  const filaCab = cab.findIndex(r => r.some(c => normal_(c) === 'fecha de solicitud'));
  const titulos = filaCab >= 0 ? cab[filaCab].map(normal_) : [];
  const col = nombre => titulos.findIndex(t => t.indexOf(nombre) === 0);
  const cFecha = col('fecha de solicitud');

  // Subir hasta la fila que inicia el bloque (tiene fecha de solicitud).
  const desde = Math.max(filaCab + 2, fila - 8);
  const tramo = sh.getRange(desde, 1, Math.min(fila - desde + 9, sh.getMaxRows() - desde + 1), ultimaCol).getValues();
  let inicio = fila - desde;
  if (cFecha >= 0) while (inicio > 0 && !String(tramo[inicio][cFecha]).trim()) inicio--;
  const bloque = [tramo[inicio]];
  for (let i = inicio + 1; i < tramo.length && !(cFecha >= 0 && String(tramo[i][cFecha]).trim()); i++) bloque.push(tramo[i]);

  const valor = c => {
    if (c < 0) return '';
    const v = bloque[0][c];
    return v instanceof Date ? fmt_(v, 'dd/MM/yyyy') : String(v).trim();
  };
  // «Nombre del evento» está como etiqueta en una celda y el valor en la siguiente.
  let evento = '';
  bloque.forEach(r => r.forEach((c, j) => { if (!evento && normal_(c) === 'nombre del evento') evento = String(r[j + 1] || '').trim(); }));
  const partes = [
    evento && 'Evento: ' + evento,
    valor(col('tipo')) && 'Tipo: ' + valor(col('tipo')),
    valor(col('fecha de entrega')) && 'Entrega: ' + valor(col('fecha de entrega')),
    valor(col('estado')) && 'Estado: ' + valor(col('estado')),
    valor(col('responsable')) && 'Responsable: ' + valor(col('responsable')),
    valor(col('solicitante')) && 'Solicita: ' + valor(col('solicitante'))
  ].filter(Boolean);
  return { fila: desde + inicio, texto: partes.join(' · '), esNuevo: false };
}

/** Trigger instalable onEdit de la hoja de requerimientos (lo crea instalarAutomatizaciones). */
function alEditarRequerimientos(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const pestana = sh.getName().trim();
  const fila = e.range.getRow();
  if (fila <= 2) return;
  let resumen;
  try { resumen = resumenRequerimiento_(sh, fila); } catch (err) { resumen = { fila: fila, texto: '' }; }

  // Es nuevo si se escribió la fecha de solicitud en una fila que estaba vacía (o se pegó un bloque entero).
  const nuevo = e.range.getNumRows() > 1 || (e.range.getColumn() === 1 && e.range.getNumColumns() === 1 && !e.oldValue);
  const marca = /^(nexo|v c|vyc)$/.test(normal_(pestana)) ? (normal_(pestana) === 'nexo' ? 'Nexo' : 'V&C') : pestana;
  const titulo = (nuevo ? 'Nuevo requerimiento en ' : 'Cambio en requerimiento de ') + marca;
  const enlace = e.source.getUrl() + '#gid=' + sh.getSheetId() + '&range=A' + resumen.fila;

  conLock_(() => notificar_(destinatariosRequerimiento_(pestana), 'requerimiento', titulo,
    resumen.texto || 'Se modificó la fila ' + fila + ' de la pestaña «' + pestana + '».', enlace,
    'req:' + sh.getSheetId() + ':' + resumen.fila));
}

/* ---------- Recordatorios de la agenda ---------- */

/** Trigger cada 5 minutos: avisa (plataforma + correo) los recordatorios que ya llegaron a su hora. */
function revisarRecordatorios() {
  const ahora = ahora_();
  const correos = [];
  conLock_(() => {
    leerTabla_('Agenda').filter(a => a.recordar_en && a.recordado !== 'SI' && a.recordar_en <= ahora && a.estado === 'pendiente')
      .forEach(a => {
        const destino = a.responsable_id || a.creado_por;
        const cuando = fmtFechaHora_(a.fecha, a.hora);
        notificar_([destino], 'recordatorio', 'Recordatorio: ' + a.titulo, cuando + (a.detalle ? ' · ' + a.detalle : ''), '', 'rec:' + a.id);
        a.recordado = 'SI';
        escribirFila_('Agenda', a);
        const u = usuarios_().find(x => x.id === destino);
        if (u && u.correo) correos.push({ correo: u.correo, nombre: u.nombre, titulo: a.titulo, cuando: cuando, detalle: a.detalle });
      });
  });
  correos.forEach(c => {
    try {
      MailApp.sendEmail({ to: c.correo, subject: 'Recordatorio: ' + c.titulo,
        htmlBody: '<p style="font-family:sans-serif">Hola ' + escHtml_(c.nombre) + ',</p>' +
          '<p style="font-family:sans-serif"><b>' + escHtml_(c.titulo) + '</b><br>' + escHtml_(c.cuando) + '</p>' +
          (c.detalle ? '<p style="font-family:sans-serif">' + escHtml_(c.detalle) + '</p>' : '') +
          '<p style="font-family:sans-serif;color:#888">MarketingVH · agenda</p>' });
    } catch (e) { console.log('No se pudo enviar correo a ' + c.correo + ': ' + e.message); }
  });
}

function fmtFechaHora_(fecha, hora) {
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const d = new Date(fecha + 'T12:00:00');
  return dias[d.getDay()] + ' ' + fecha.slice(8) + '/' + fecha.slice(5, 7) + (hora ? ' a las ' + hora : '');
}
