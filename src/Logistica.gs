/**
 * Logística por evento: lista de equipos y activos que salen al evento, con checklist de salida y retorno.
 * - Inventario: catálogo de equipos/activos ya registrados (para buscarlos y no volver a escribirlos).
 * - Logistica: los ítems de cada evento.
 * - Los equipos alquilados del evento (Alquileres.gs) se incluyen siempre, automáticamente.
 * - Se exporta a un Google Sheet con el formato de logística que usa coordinación de eventos.
 */

const CATEGORIAS_LOGISTICA = ['Cámara', 'Micrófono', 'Drone', 'Cargador', 'Batería', 'Celular', 'Trípode', 'Gimbal',
  'Adaptador', 'Extensión', 'Mochila', 'Accesorios', 'Gripería', 'Otro'];
const CARPETA_LOGISTICA = 'MarketingVH · Logística';

function categoriasLogistica_() {
  const l = lista_('categorias_logistica');
  return l.length ? l : CATEGORIAS_LOGISTICA;
}

function eventoPorId_(id) {
  const ev = eventosConPersonal_(e => e.id === id)[0];
  if (!ev) throw new Error('Evento no encontrado.');
  return ev;
}

/** Filas automáticas a partir de los equipos alquilados del evento. */
function filasAlquiler_(eventoId) {
  return leerTabla_('Alquileres').filter(a => a.evento_id === eventoId && a.estado !== 'eliminado').map(a => ({
    id: 'alq-' + a.id, categoria: 'Alquiler', nombre: a.equipo + (a.detalle ? ' · ' + a.detalle : ''),
    cantidad: Number(a.cantidad) || 1, origen: a.proveedor || 'Alquiler', responsable: config_().responsable_alquiler || 'Jefferson',
    observaciones: 'Equipo alquilado' + (a.proveedor ? ' a ' + a.proveedor : '') + ' · ' + a.estado, alquiler: true
  }));
}

function getLogistica(token, eventoId) {
  const u = sesion_(token);
  exigirGestor_(u);
  const ev = eventoPorId_(eventoId);
  const items = leerTabla_('Logistica').filter(x => x.evento_id === eventoId && x.estado !== 'eliminado')
    .sort((a, b) => Number(a.orden) - Number(b.orden))
    .map(x => ({ id: x.id, categoria: x.categoria, nombre: x.nombre, cantidad: Number(x.cantidad) || 1, origen: x.origen,
      responsable: x.responsable, observaciones: x.observaciones }));
  const eventoFila = leerTabla_('Eventos').find(e => e.id === eventoId) || {};
  return {
    evento: { id: ev.id, titulo: ev.titulo, fecha: ev.fecha, hora_inicio: ev.hora_inicio, hora_fin: ev.hora_fin,
      lugar: ev.lugar, empresa: ev.empresa, personal: ev.personal.map(p => p.nombre) },
    items: items,
    alquiler: filasAlquiler_(eventoId),
    catalogo: leerTabla_('Inventario').filter(x => x.activo !== 'NO')
      .map(x => ({ categoria: x.categoria, nombre: x.nombre, origen: x.origen }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    categorias: categoriasLogistica_(),
    url: eventoFila.logistica_url || ''
  };
}

/** Guarda la lista del evento (reemplaza la anterior) y agrega al catálogo los equipos nuevos. */
function guardarLogistica(token, eventoId, items) {
  const u = sesion_(token);
  exigirGestor_(u);
  eventoPorId_(eventoId);
  const limpios = (Array.isArray(items) ? items : []).map((x, i) => {
    const cantidad = x.cantidad === '' || x.cantidad == null ? 1 : Math.round(Number(x.cantidad));
    if (!(cantidad >= 1 && cantidad <= 9999)) throw new Error('La cantidad debe ser un número entre 1 y 9999.');
    const nombre = texto_(x.nombre, 200);
    if (!nombre) throw new Error('Cada fila necesita el nombre del equipo o activo.');
    return {
      id: texto_(x.id, 40), categoria: texto_(x.categoria, 60) || 'Otro', nombre: nombre, cantidad: String(cantidad),
      origen: texto_(x.origen, 120) || 'Marketing', responsable: texto_(x.responsable, 120), observaciones: texto_(x.observaciones, 300),
      orden: String(i + 1)
    };
  });
  conLock_(() => {
    const ahora = ahora_();
    const actuales = leerTabla_('Logistica').filter(x => x.evento_id === eventoId && x.estado !== 'eliminado');
    const nuevas = [];
    limpios.forEach(x => {
      const a = x.id && actuales.find(y => y.id === x.id);
      if (a) { Object.assign(a, x, { actualizado: ahora }); escribirFila_('Logistica', a); }
      else nuevas.push(Object.assign({}, x, { id: uuid_(), evento_id: eventoId, estado: 'activo', actualizado: ahora }));
    });
    actuales.filter(a => !limpios.some(x => x.id === a.id)).forEach(a => {
      a.estado = 'eliminado';
      a.actualizado = ahora;
      escribirFila_('Logistica', a);
    });
    agregarFilas_('Logistica', nuevas);

    // Catálogo: lo nuevo se guarda para el buscador; lo existente actualiza su categoría/origen.
    const catalogo = leerTabla_('Inventario');
    const clave = s => normal_(s);
    const nuevosCat = [];
    limpios.forEach(x => {
      const c = catalogo.find(y => clave(y.nombre) === clave(x.nombre)) || nuevosCat.find(y => clave(y.nombre) === clave(x.nombre));
      if (!c) {
        nuevosCat.push({ id: uuid_(), categoria: x.categoria, nombre: x.nombre, origen: x.origen, activo: 'SI', creado: ahora });
      } else if (c._fila && (c.categoria !== x.categoria || (x.origen && c.origen !== x.origen))) {
        c.categoria = x.categoria;
        if (x.origen) c.origen = x.origen;
        escribirFila_('Inventario', c);
      }
    });
    agregarFilas_('Inventario', nuevosCat);
    log_(u.id, 'guardar_logistica', eventoId, limpios.length + ' ítems');
  });
  return getLogistica(token, eventoId);
}

/** Quita un equipo del buscador (no afecta listas ya guardadas). */
function quitarDelCatalogo(token, nombre) {
  const u = sesion_(token);
  exigirGestor_(u);
  conLock_(() => {
    const c = leerTabla_('Inventario').find(y => normal_(y.nombre) === normal_(nombre));
    if (c) { c.activo = 'NO'; escribirFila_('Inventario', c); }
  });
  return true;
}

/**
 * Genera (o actualiza) el Google Sheet de logística del evento con el formato de coordinación de eventos:
 * Ítem, Categoría, Equipo / Activo, Cantidad, Origen / Ubicación, Responsable, Salida (Check), Retorno (Check), Observaciones.
 */
function exportarLogistica(token, eventoId) {
  const u = sesion_(token);
  exigirGestor_(u);
  const d = getLogistica(token, eventoId);
  const ev = d.evento;
  // Agrupado por categoría (en el orden en que aparecen); los alquilados al final.
  const orden = [];
  d.items.forEach(x => { if (orden.indexOf(x.categoria) < 0) orden.push(x.categoria); });
  const filas = orden.reduce((acc, c) => acc.concat(d.items.filter(x => x.categoria === c)), []).concat(d.alquiler);

  const fecha = ev.fecha.slice(8) + '/' + ev.fecha.slice(5, 7) + '/' + ev.fecha.slice(0, 4);
  const titulo = 'Logística · ' + ev.titulo + ' · ' + fecha;
  let ss = null;
  const anterior = idDeUrl_(d.url);
  if (anterior) { try { ss = SpreadsheetApp.openById(anterior); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(titulo);
    ss.setSpreadsheetLocale('es_PE');
    const carpetas = DriveApp.getFoldersByName(CARPETA_LOGISTICA);
    const carpeta = carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(CARPETA_LOGISTICA);
    DriveApp.getFileById(ss.getId()).moveTo(carpeta);
  } else {
    ss.rename(titulo);
  }
  const sh = ss.getSheets()[0].setName('Logística');
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations().breakApart();

  const verde = '#356854';
  const n = filas.length;
  if (sh.getMaxRows() < n + 10) sh.insertRowsAfter(sh.getMaxRows(), n + 10 - sh.getMaxRows());
  sh.getRange('A1:I1').merge().setValue('LOGÍSTICA · ' + ev.titulo.toUpperCase())
    .setBackground(verde).setFontColor('#ffffff').setFontWeight('bold').setFontSize(14).setVerticalAlignment('middle');
  sh.setRowHeight(1, 34);
  sh.getRange('A2:I2').merge().setValue([
    'Fecha: ' + fecha, (ev.hora_inicio ? 'Hora: ' + ev.hora_inicio + (ev.hora_fin ? '–' + ev.hora_fin : '') : ''),
    ev.lugar ? 'Lugar: ' + ev.lugar : '', 'Marca: ' + ev.empresa
  ].filter(String).join('   ·   ')).setFontWeight('bold');
  sh.getRange('A3:I3').merge().setValue((ev.personal.length ? 'Equipo de marketing: ' + ev.personal.join(', ') + '   ·   ' : '') +
    'Generado el ' + fmt_(new Date(), 'dd/MM/yyyy HH:mm') + ' desde MarketingVH').setFontColor('#666666').setFontSize(9);

  const cab = ['Ítem', 'Categoría', 'Equipo / Activo', 'Cantidad', 'Origen / Ubicación', 'Responsable', 'Salida (Check)', 'Retorno (Check)', 'Observaciones'];
  sh.getRange(5, 1, 1, cab.length).setValues([cab]).setBackground(verde).setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(5, 30);
  if (n) {
    sh.getRange(6, 1, n, cab.length).setValues(filas.map((x, i) => [i + 1, x.categoria, x.nombre, x.cantidad, x.origen,
      x.responsable, false, false, x.observaciones]));
    sh.getRange(6, 7, n, 2).insertCheckboxes();
    sh.getRange(6, 1, n, cab.length).setVerticalAlignment('middle')
      .setBorder(true, true, true, true, true, true, '#bdbdbd', SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(6, 1, n, 1).setHorizontalAlignment('center');
    sh.getRange(6, 4, n, 1).setHorizontalAlignment('center');
    sh.getRange(6, 7, n, 2).setHorizontalAlignment('center');
    sh.getRange(6, 9, n, 1).setWrap(true);
    // Verificación visual: amarillo = salió y falta que regrese; verde = regresó.
    const rango = sh.getRange(6, 1, n, cab.length);
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$H6=TRUE').setBackground('#c8e6c9').setRanges([rango]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($G6=TRUE,$H6=FALSE)').setBackground('#fff3c4').setRanges([rango]).build()
    ]);
    const filaTotal = 6 + n + 1;
    sh.getRange(filaTotal, 3).setValue('Total de ítems: ' + n).setFontWeight('bold');
    sh.getRange(filaTotal + 2, 1, 1, 9).merge().setValue('Entregó: ____________________        Recibió: ____________________        Retornó: ____________________')
      .setFontColor('#444444');
  }
  [72, 146, 380, 90, 175, 190, 120, 130, 260].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.setFrozenRows(5);

  conLock_(() => {
    const e = leerTabla_('Eventos').find(x => x.id === eventoId);
    if (e) { e.logistica_url = ss.getUrl(); escribirFila_('Eventos', e); }
    log_(u.id, 'exportar_logistica', eventoId, n + ' ítems');
  });
  return { url: ss.getUrl(), titulo: titulo, items: n };
}
