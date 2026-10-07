/**
 * Parrillas de contenido: un Google Sheet por marca con una pestaña por mes (mismo formato que la parrilla
 * de Academia: Fecha, Hora, Red social, Estado, Título, Caption, Enlace, Diseño, Formato, Pilar, Encargado).
 * Cada fila con fecha y título se sincroniza como «Publicación» en la agenda y el calendario.
 */

const CARPETA_PARRILLAS = 'MarketingVH · Parrillas';
const MESES_ES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const PARRILLA_HASTA = '2027-12';
const FILAS_PARRILLA = 120;
const LISTAS_PARRILLA = {
  red: ['Instagram', 'Facebook', 'TikTok', 'IG + FB', 'Todas', 'YouTube', 'LinkedIn'],
  estado: ['Pendiente', 'Programado', 'Publicado', 'Falta', 'Cancelado'],
  diseno: ['Por hacer', 'En proceso', 'LISTO', 'Corregir'],
  formato: ['🎥 Reel', '🖼️ Imagen', '🖼️ Carrusel', '📱 Historia', '🎬 Video', '🔴 Live'],
  pilar: ['Contenido', 'Educativo', 'Recap', 'Clip evento', 'Testimonio', 'Promocional', 'Institucional']
};

/* ---------- Lista y enlaces ---------- */

function idDeUrl_(url) {
  const m = String(url).match(/\/d\/([\w-]+)/);
  return m ? m[1] : '';
}

function listarParrillas(token) {
  sesion_(token);
  return leerTabla_('Parrillas').filter(p => p.activo === 'SI')
    .map(p => ({ id: p.id, marca: p.marca, nombre: p.nombre, url: p.url, ultima_sync: p.ultima_sync, estado_sync: p.estado_sync }))
    .sort((a, b) => (a.marca + a.nombre).localeCompare(b.marca + b.nombre));
}

function guardarParrilla(token, d) {
  const u = sesion_(token);
  exigirGestor_(u);
  d = d || {};
  const datos = {
    marca: opcion_(d.marca, lista_('marcas'), 'Elige la marca.'),
    nombre: texto_(d.nombre, 120),
    url: texto_(d.url, 500)
  };
  if (!datos.nombre) throw new Error('Escribe un nombre para la parrilla.');
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+/.test(datos.url)) {
    throw new Error('Pega el enlace de un Google Sheet (https://docs.google.com/spreadsheets/d/…).');
  }
  datos.sheet_id = idDeUrl_(datos.url);
  conLock_(() => {
    if (d.id) {
      const p = leerTabla_('Parrillas').find(x => x.id === d.id);
      if (!p) throw new Error('No encontrada.');
      Object.assign(p, datos, { activo: d.activo === false ? 'NO' : 'SI' });
      escribirFila_('Parrillas', p);
    } else {
      agregarFila_('Parrillas', Object.assign({ id: uuid_(), activo: 'SI', creado: ahora_(), ultima_sync: '', estado_sync: '' }, datos));
    }
    log_(u.id, 'guardar_parrilla', d.id || '', datos.marca + ' · ' + datos.nombre);
  });
  sincronizarParrillas_();
  return true;
}

/* ---------- Creación de parrillas por marca ---------- */

function crearParrillas(token) {
  const u = sesion_(token);
  exigirAdmin_(u);
  return crearParrillas_(u.id);
}

/** También se puede ejecutar desde el editor. */
function crearParrillasDesdeEditor() {
  console.log(JSON.stringify(crearParrillas_('editor')));
}

function crearParrillas_(autor) {
  const existentes = leerTabla_('Parrillas').filter(p => p.activo === 'SI' && p.nombre.indexOf('PARRILLA ') === 0);
  const faltan = lista_('marcas').filter(m => !existentes.some(p => p.marca === m));
  if (!faltan.length) return { creadas: [] };

  const carpetas = DriveApp.getFoldersByName(CARPETA_PARRILLAS);
  const carpeta = carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(CARPETA_PARRILLAS);
  const plantilla = crearPlantillaParrilla_();
  const archivo = DriveApp.getFileById(plantilla.getId());
  archivo.moveTo(carpeta);

  const creadas = [];
  faltan.forEach(marca => {
    const copia = archivo.makeCopy('PARRILLA ' + marca.toUpperCase() + ' ' + hoy_().slice(0, 4) + '-' + PARRILLA_HASTA.slice(0, 4), carpeta);
    SpreadsheetApp.openById(copia.getId()).getSheetByName('Listas').getRange('B2').setValue(marca);
    creadas.push({ marca: marca, url: copia.getUrl(), id: copia.getId() });
  });
  archivo.setName('Plantilla de parrilla (no editar)');

  conLock_(() => {
    agregarFilas_('Parrillas', creadas.map(c => ({
      id: uuid_(), marca: c.marca, nombre: 'PARRILLA ' + c.marca.toUpperCase(), url: c.url, activo: 'SI',
      creado: ahora_(), sheet_id: c.id, ultima_sync: '', estado_sync: ''
    })));
    log_(autor, 'crear_parrillas', '', creadas.map(c => c.marca).join(', '));
  });
  return { creadas: creadas, carpeta: carpeta.getUrl() };
}

function crearPlantillaParrilla_() {
  const ss = SpreadsheetApp.create('Plantilla de parrilla');
  ss.setSpreadsheetLocale('es_PE');
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());

  const listas = ss.getSheets()[0].setName('Listas');
  const equipo = usuarios_().filter(x => x.activo === 'SI' && x.rol !== 'admin').map(x => [x.nombre]);
  listas.getRange('A1:B1').setValues([['Encargados (puedes editar esta lista)', 'Marca']]).setFontWeight('bold');
  listas.getRange('B2').setValue('MARCA');
  if (equipo.length) listas.getRange(2, 1, equipo.length, 1).setValues(equipo);

  let mes = hoy_().slice(0, 7);
  while (mes <= PARRILLA_HASTA) {
    armarMesParrilla_(ss.insertSheet(), mes, listas);
    mes = mes.slice(5) === '12' ? (Number(mes.slice(0, 4)) + 1) + '-01' : mes.slice(0, 5) + String(Number(mes.slice(5)) + 1).padStart(2, '0');
  }
  ss.setActiveSheet(ss.getSheets()[1]);
  ss.moveActiveSheet(1);
  listas.hideSheet();
  SpreadsheetApp.flush();
  return ss;
}

function armarMesParrilla_(sh, mes, listas) {
  const anio = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  const nombreMes = MESES_ES[m - 1] + ' ' + anio;
  sh.setName(nombreMes);
  const n = FILAS_PARRILLA;
  if (sh.getMaxColumns() > 12) sh.deleteColumns(13, sh.getMaxColumns() - 12);
  if (sh.getMaxRows() < n + 3) sh.insertRowsAfter(sh.getMaxRows(), n + 3 - sh.getMaxRows());

  [90, 120, 85, 120, 115, 230, 380, 170, 105, 120, 120, 120].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange('A1:L1').merge().setFormula('="PARRILLA DE CONTENIDO · "&UPPER(Listas!B2)&" · ' + nombreMes + '"')
    .setBackground('#1f9d3a').setFontColor('#ffffff').setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1, 38);
  sh.setRowHeight(2, 8);
  sh.getRange('A3:L3').setValues([['🗓️ Semana', '📆 Fecha', '⏰ Hora', '👥 Red social', '📌 Estado', 'Título', 'Caption',
    '🔗 Enlace material', '✅ Diseño', 'Formato', 'Pilar', 'Encargado']])
    .setBackground('#93c47d').setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
  sh.setFrozenRows(3);

  const datos = sh.getRange(4, 1, n, 12);
  datos.setVerticalAlignment('middle').setBorder(true, true, true, true, true, true, '#d9d9d9', SpreadsheetApp.BorderStyle.SOLID);
  // setFormula usa siempre la sintaxis en inglés (comas), sin importar la configuración regional.
  const b = 'B4:B' + (n + 3);
  sh.getRange(4, 1).setFormula('=ARRAYFORMULA(IF(' + b + '="","","Semana "&(WEEKNUM(' + b + ',2)-WEEKNUM(DATE(YEAR(' + b +
    '),MONTH(' + b + '),1),2)+1)))');
  sh.getRange(4, 1, n, 1).setFontColor('#1f9d3a').setFontWeight('bold').setHorizontalAlignment('center');

  const primero = new Date(anio, m - 1, 1);
  const ultimo = new Date(anio, m, 0);
  sh.getRange(4, 2, n, 1).setNumberFormat('ddd dd/mm').setBackground('#d9ead3').setFontWeight('bold').setHorizontalAlignment('center')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDateBetween(primero, ultimo)
      .setHelpText('Fecha de ' + nombreMes.toLowerCase()).setAllowInvalid(false).build());
  sh.getRange(4, 3, n, 1).setNumberFormat('h:mm am/pm').setHorizontalAlignment('center');

  const lista = (col, valores) => sh.getRange(4, col, n, 1).setHorizontalAlignment('center').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(valores, true).setAllowInvalid(false).build());
  lista(4, LISTAS_PARRILLA.red);
  lista(5, LISTAS_PARRILLA.estado);
  lista(9, LISTAS_PARRILLA.diseno);
  lista(10, LISTAS_PARRILLA.formato);
  lista(11, LISTAS_PARRILLA.pilar);
  sh.getRange(4, 12, n, 1).setHorizontalAlignment('center').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(listas.getRange('A2:A60'), true).setAllowInvalid(true).build());
  sh.getRange(4, 6, n, 2).setWrap(true);
  sh.getRange(4, 6, n, 1).setFontWeight('bold');

  const colores = [['Publicado', '#b7e1cd'], ['Programado', '#c9daf8'], ['Pendiente', '#fce8b2'], ['Falta', '#f4c7c3'], ['Cancelado', '#e0e0e0']];
  const reglas = colores.map(c => SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(c[0]).setBackground(c[1])
    .setRanges([sh.getRange(4, 5, n, 1)]).build());
  reglas.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('LISTO').setBackground('#b7e1cd')
    .setRanges([sh.getRange(4, 9, n, 1)]).build());
  reglas.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Corregir').setBackground('#f4c7c3')
    .setRanges([sh.getRange(4, 9, n, 1)]).build());
  sh.setConditionalFormatRules(reglas);
}

/* ---------- Sincronización con la agenda ---------- */

const COLUMNAS_PARRILLA = {
  fecha: ['fecha'], hora: ['hora'], red: ['red social', 'red'], estado: ['estado'], titulo: ['titulo'],
  caption: ['caption', 'copy'], enlace: ['enlace material', 'enlace', 'link'], diseno: ['diseno'],
  formato: ['formato'], pilar: ['pilar'], encargado: ['encargado', 'responsable']
};

function horaCelda_(v) {
  if (v instanceof Date && !isNaN(v)) return fmt_(v, 'HH:mm');
  if (typeof v === 'number' && v > 0 && v < 1) {
    const min = Math.round(v * 1440);
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }
  const m = String(v || '').toLowerCase().replace(/\s/g, '').match(/^(\d{1,2})(?::(\d{2}))?([ap])?/);
  if (!m) return '';
  let h = Number(m[1]);
  if (m[3] === 'p' && h < 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  return h > 23 ? '' : String(h).padStart(2, '0') + ':' + (m[2] || '00');
}

function estadoParrilla_(v) {
  const s = normal_(v);
  if (s.indexOf('publicad') === 0) return 'hecho';
  if (s.indexOf('cancel') === 0) return 'cancelado';
  return 'pendiente';
}

function leerParrilla_(p, porNombre) {
  const ss = SpreadsheetApp.openById(p.sheet_id || idDeUrl_(p.url));
  const items = [];
  ss.getSheets().filter(sh => sh.getName() !== 'Listas').forEach(sh => {
    const valores = sh.getDataRange().getValues();
    let cab = -1;
    let mapa = {};
    for (let i = 0; i < Math.min(10, valores.length); i++) {
      const norm = valores[i].map(normal_);
      if (norm.indexOf('titulo') >= 0 && norm.some(h => h.indexOf('fecha') >= 0)) {
        cab = i;
        Object.keys(COLUMNAS_PARRILLA).forEach(k => {
          const j = norm.findIndex(h => COLUMNAS_PARRILLA[k].some(s => h === s || h.indexOf(s) === 0));
          if (j >= 0) mapa[k] = j;
        });
        break;
      }
    }
    if (cab < 0) return;
    const val = (r, k) => (mapa[k] === undefined ? '' : r[mapa[k]]);
    let fechaAnterior = '';
    valores.slice(cab + 1).forEach((r, i) => {
      const celda = val(r, 'fecha');
      const fecha = celda instanceof Date && !isNaN(celda) ? fmt_(celda, 'yyyy-MM-dd') : (celda === '' ? fechaAnterior : '');
      if (celda instanceof Date) fechaAnterior = fecha;
      const titulo = String(val(r, 'titulo')).trim();
      if (!fecha || !titulo) return;
      const encargado = normal_(val(r, 'encargado')).split(' ')[0];
      items.push({
        id: p.id.slice(0, 8) + '-' + sh.getSheetId() + '-' + (cab + 2 + i),
        fecha: fecha, hora: horaCelda_(val(r, 'hora')), titulo: titulo.slice(0, 200), tipo: 'Publicación', marca: p.marca,
        campana: '', responsable_id: (porNombre[encargado] || {}).id || '', estado: estadoParrilla_(val(r, 'estado')),
        detalle: String(val(r, 'caption')).slice(0, 500), origen: 'parrilla:' + p.id, creado_por: 'parrilla', actualizada: ahora_(),
        red: String(val(r, 'red')).slice(0, 40), formato: String(val(r, 'formato')).slice(0, 40), pilar: String(val(r, 'pilar')).slice(0, 40),
        enlace: String(val(r, 'enlace')).slice(0, 300), estado_material: String(val(r, 'diseno')).slice(0, 40)
      });
    });
  });
  return items;
}

/** Relee todas las parrillas y reemplaza sus publicaciones en la agenda (lo manual no se toca). */
function sincronizarParrillas_() {
  const parrillas = leerTabla_('Parrillas').filter(p => p.activo === 'SI');
  const porNombre = {};
  usuarios_().filter(x => x.activo === 'SI').forEach(x => { porNombre[normal_(x.nombre).split(' ')[0]] = x; });
  const nuevos = [];
  const estados = {};
  parrillas.forEach(p => {
    try {
      const items = leerParrilla_(p, porNombre);
      items.forEach(x => nuevos.push(x));
      estados[p.id] = 'OK · ' + items.length + ' publicaciones';
    } catch (e) {
      estados[p.id] = /not supported|no es compatible|Service Spreadsheets failed/i.test(e.message)
        ? 'Error: el archivo no es un Google Sheet (si es .xlsx, ábrelo y usa Archivo → Guardar como Hojas de cálculo de Google)'
        : 'Error: ' + e.message;
    }
  });
  conLock_(() => {
    const agenda = leerTabla_('Agenda');
    const conservar = agenda.filter(a => {
      if (!esDeParrilla_(a)) return true;
      const id = a.origen.slice('parrilla:'.length);
      return estados[id] && estados[id].indexOf('Error') === 0; // si falló, se conservan sus datos anteriores
    });
    reescribirTabla_('Agenda', conservar.concat(nuevos));
    leerTabla_('Parrillas').forEach(p => {
      if (!estados[p.id]) return;
      p.ultima_sync = ahora_();
      p.estado_sync = estados[p.id];
      escribirFila_('Parrillas', p);
    });
  });
  return parrillas.map(p => ({ nombre: p.nombre, estado: estados[p.id] }));
}
