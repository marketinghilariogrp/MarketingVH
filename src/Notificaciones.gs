/**
 * Notificaciones dentro de la plataforma (campana en la barra superior); cada una también se envía por correo
 * (desde la cuenta dueña del script, marketing@hilariogrp.com) al correo con el que la persona entra a la plataforma.
 * Fuentes:
 * - Hoja «Requerimiento de Diseño 2026»: cada cambio avisa a Gabriela y, según la pestaña, a Blue o a Chris
 *   (reglas en Config.notif_requerimientos_reglas). Trigger instalable alEditarRequerimientos.
 * - Recordatorios de la agenda: trigger revisarRecordatorios cada minuto, que además despacha los correos pendientes.
 * Los correos se encolan (columna correo = 'pendiente') para no hacer esperar a quien ejecuta la acción.
 */

const MINUTOS_AGRUPAR = 30; // cambios seguidos en el mismo requerimiento se juntan en una sola notificación
const MINUTOS_ESPERA_CORREO = 2; // un requerimiento se edita celda por celda: se espera a que paren los cambios para mandar un solo correo

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
      Object.assign(n, { titulo: titulo, detalle: detalle, enlace: enlace || '', actualizada: ahora, correo: 'pendiente' });
      escribirFila_('Notificaciones', n);
    } else {
      nuevas.push({ id: uuid_(), usuario_id: uid, fecha_hora: ahora, tipo: tipo, titulo: titulo, detalle: detalle,
        enlace: enlace || '', leida: 'NO', clave: clave || '', actualizada: ahora, correo: 'pendiente' });
    }
  });
  agregarFilas_('Notificaciones', nuevas);
  olvidarContador_(usuarioIds);
}

function listarNotificaciones(token) {
  const u = sesion_(token);
  return leerTabla_('Notificaciones').filter(n => n.usuario_id === u.id)
    .sort((a, b) => b.actualizada.localeCompare(a.actualizada)).slice(0, 100)
    .map(n => ({ id: n.id, tipo: n.tipo, titulo: n.titulo, detalle: n.detalle, enlace: n.enlace, leida: n.leida === 'SI', fecha: n.actualizada }));
}

function contarNotificaciones(token) {
  const u = sesion_(token);
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('notif_' + u.id);
  if (guardado !== null) return Number(guardado);
  const n = leerTabla_('Notificaciones').filter(x => x.usuario_id === u.id && x.leida !== 'SI').length;
  cache.put('notif_' + u.id, String(n), 600);
  return n;
}

/** El contador en caché se borra cuando cambian las notificaciones de esas personas. */
function olvidarContador_(usuarioIds) {
  CacheService.getScriptCache().removeAll(usuarioIds.filter(Boolean).map(id => 'notif_' + id));
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
  olvidarContador_([u.id]);
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

/** Trigger cada minuto: avisa los recordatorios que ya llegaron a su hora y envía los correos pendientes. */
function revisarRecordatorios() {
  const ahora = ahora_();
  conLock_(() => {
    leerTabla_('Agenda').filter(a => a.recordar_en && a.recordado !== 'SI' && a.recordar_en <= ahora && a.estado === 'pendiente')
      .forEach(a => {
        const destino = a.responsable_id || a.creado_por;
        const cuando = fmtFechaHora_(a.fecha, a.hora);
        notificar_([destino], 'recordatorio', 'Recordatorio: ' + a.titulo, cuando + (a.detalle ? ' · ' + a.detalle : ''), '', 'rec:' + a.id);
        a.recordado = 'SI';
        escribirFila_('Agenda', a);
      });
  });
  enviarCorreosNotificaciones();
}

/* ---------- Correos de las notificaciones ---------- */

/**
 * Envía por correo las notificaciones pendientes, un solo correo por persona aunque tenga varias.
 * Se omiten las que la persona ya leyó en la plataforma y las de quien no tiene correo o está inactivo.
 */
function enviarCorreosNotificaciones() {
  const activo = config_().notif_correo !== 'NO';
  const limite = fmt_(new Date(Date.now() - MINUTOS_ESPERA_CORREO * 60000), 'yyyy-MM-dd HH:mm:ss');
  let cupo = MailApp.getRemainingDailyQuota();
  const envios = {};
  conLock_(() => {
    leerTabla_('Notificaciones')
      .filter(n => n.correo === 'pendiente' && (n.tipo !== 'requerimiento' || n.actualizada <= limite))
      .sort((a, b) => a.actualizada.localeCompare(b.actualizada))
      .forEach(n => {
        const u = usuarios_().find(x => x.id === n.usuario_id);
        const valido = activo && u && u.correo && u.activo !== 'NO' && n.leida !== 'SI';
        if (valido && !envios[u.id]) {
          if (cupo <= 0) return; // sin cupo diario: queda pendiente para el día siguiente
          cupo--;
          envios[u.id] = { usuario: u, lista: [] };
        }
        if (valido) envios[u.id].lista.push(n);
        n.correo = valido ? 'enviado' : 'omitido';
        escribirFila_('Notificaciones', n);
      });
  });
  Object.keys(envios).forEach(id => {
    const e = envios[id];
    try {
      MailApp.sendEmail({ to: e.usuario.correo, name: 'MarketingVH', subject: asuntoCorreo_(e.lista),
        htmlBody: cuerpoCorreo_(e.usuario, e.lista) });
    } catch (err) { console.log('No se pudo enviar correo a ' + e.usuario.correo + ': ' + err.message); }
  });
  return Object.keys(envios).length;
}

function asuntoCorreo_(lista) {
  return lista.length === 1 ? lista[0].titulo : 'MarketingVH · ' + lista.length + ' notificaciones nuevas';
}

function cuerpoCorreo_(u, lista) {
  let app = '';
  try { app = ScriptApp.getService().getUrl() || ''; } catch (e) { /* sin URL publicada */ }
  const p = 'font-family:Arial,sans-serif;font-size:14px;color:#222;margin:0 0 10px';
  const items = lista.map(n =>
    '<div style="border-left:3px solid #356854;padding:6px 12px;margin:0 0 12px">' +
      '<p style="' + p + ';margin:0 0 4px"><b>' + escHtml_(n.titulo) + '</b></p>' +
      (n.detalle ? '<p style="' + p + ';margin:0 0 4px">' + escHtml_(n.detalle) + '</p>' : '') +
      '<p style="' + p + ';margin:0;color:#888;font-size:12px">' + escHtml_(n.actualizada.slice(8, 10) + '/' + n.actualizada.slice(5, 7) +
        ' ' + n.actualizada.slice(11, 16)) +
        (n.enlace ? ' · <a href="' + escHtml_(n.enlace) + '" style="color:#356854">Abrir</a>' : '') + '</p>' +
    '</div>').join('');
  return '<p style="' + p + '">Hola ' + escHtml_(String(u.nombre).split(' ')[0]) + ',</p>' +
    '<p style="' + p + '">' + (lista.length === 1 ? 'Tienes una notificación nueva:' : 'Tienes ' + lista.length + ' notificaciones nuevas:') + '</p>' +
    items +
    (app ? '<p style="' + p + '"><a href="' + escHtml_(app) + '" style="background:#356854;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">Ir a MarketingVH</a></p>' : '') +
    '<p style="' + p + ';color:#888;font-size:12px">Correo automático de MarketingVH. También lo ves en la campana de la plataforma.</p>';
}

function fmtFechaHora_(fecha, hora) {
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const d = new Date(fecha + 'T12:00:00');
  return dias[d.getDay()] + ' ' + fecha.slice(8) + '/' + fecha.slice(5, 7) + (hora ? ' a las ' + hora : '');
}
