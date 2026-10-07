/**
 * Utilidades compartidas: acceso a la base, lecturas en bloque, caché, bloqueo y log.
 * Todos los valores se guardan como texto para que Sheets no los convierta solo.
 * Las columnas nuevas se agregan SIEMPRE al final de cada lista (setup() migra las hojas existentes).
 */

const ESQUEMA = {
  Usuarios: ['id', 'nombre', 'correo', 'rol', 'area', 'pin_hash', 'jornada_horas', 'activo', 'creado'],
  Tareas: ['id', 'titulo', 'descripcion', 'usuario_id', 'creada_por', 'prioridad', 'estado',
    'creada', 'vence', 'completada', 'peso', 'nota', 'actualizada',
    'marca', 'campana', 'pieza', 'tipo', 'solicitud_id', 'archivada'],
  Solicitudes: ['id', 'titulo', 'descripcion', 'tipo', 'marca', 'solicitante_id', 'prioridad',
    'fecha_entrega', 'estado', 'tarea_id', 'creada', 'actualizada', 'nota'],
  Horas: ['id', 'usuario_id', 'fecha', 'inicio', 'fin', 'horas', 'funcion', 'marca', 'tarea_id',
    'descripcion', 'creado', 'estado'],
  // Marcación de entrada y salida por día (las horas y el sobretiempo se calculan al leer).
  Asistencia: ['id', 'usuario_id', 'fecha', 'entrada', 'salida', 'tipo_dia', 'horas', 'extra', 'actualizado', 'nota'],
  Sobretiempo: ['id', 'usuario_id', 'fecha', 'inicio', 'fin', 'horas', 'motivo', 'evento_id', 'estado',
    'revisado_por', 'nota', 'creado'],
  // Compensaciones de sobretiempo (días u horas libres, pago) registradas por el admin / RR. HH.
  Ajustes_saldo: ['id', 'usuario_id', 'fecha', 'motivo', 'tipo', 'cantidad', 'registrado_por', 'creado'],
  Eventos: ['id', 'fecha', 'titulo', 'detalle', 'lugar', 'calendar_id', 'estado',
    'empresa', 'hora_inicio', 'hora_fin', 'creado_por', 'actualizada'],
  Cobertura: ['id', 'evento_id', 'usuario_id', 'rol_en_evento', 'estado', 'zona', 'horario', 'nota'],
  Agenda: ['id', 'fecha', 'hora', 'titulo', 'tipo', 'marca', 'campana', 'responsable_id', 'estado',
    'detalle', 'origen', 'creado_por', 'actualizada', 'red', 'formato', 'pilar', 'enlace', 'estado_material',
    'privado', 'recordatorio_min', 'recordar_en', 'recordado'],
  Notificaciones: ['id', 'usuario_id', 'fecha_hora', 'tipo', 'titulo', 'detalle', 'enlace', 'leida', 'clave', 'actualizada'],
  Parrillas: ['id', 'marca', 'nombre', 'url', 'activo', 'creado', 'sheet_id', 'ultima_sync', 'estado_sync'],
  // Fuentes de pauta: Google Sheets del equipo que se leen y consolidan en Pauta_diaria.
  Fuentes_pauta: ['id', 'marca', 'nombre', 'url', 'hoja', 'activo', 'creado', 'ultima_sync', 'estado_sync', 'filas', 'moneda'],
  // inversion está en la moneda original de la cuenta (columna moneda: PEN o USD).
  Pauta_diaria: ['fuente_id', 'marca', 'fecha', 'fecha_fin', 'campana', 'inversion', 'alcance', 'impresiones',
    'clics', 'resultados', 'tipo_resultado', 'leads', 'mensajes', 'moneda'],
  Alquileres: ['id', 'evento_id', 'equipo', 'detalle', 'cantidad', 'proveedor', 'costo', 'estado', 'creado_por', 'actualizado'],
  Redes_cuentas: ['id', 'marca', 'red', 'usuario', 'url', 'activo'],
  Redes_metricas: ['id', 'cuenta_id', 'mes', 'seguidores', 'alcance', 'visualizaciones', 'interacciones',
    'publicaciones', 'registrado_por', 'actualizado'],
  Resumen_mensual: ['mes', 'usuario_id', 'tareas_ok', 'a_tiempo', 'horas_extra', 'eventos', 'saldo'],
  Config: ['clave', 'valor', 'descripcion'],
  Log: ['fecha_hora', 'usuario', 'accion', 'id_afectado', 'detalle']
};

/*
 * Memoria por ejecución: abrir el archivo de datos y leer una pestaña es lo más lento de Apps Script,
 * así que dentro de una misma llamada se hace una sola vez. Escribir en una pestaña invalida su lectura,
 * y conLock_ la vacía al empezar para leer datos frescos dentro del bloqueo.
 */
let memoArchivo_ = null;
const memoHojas_ = {};
let memoTablas_ = {};

function db_() {
  if (memoArchivo_) return memoArchivo_;
  const id = PropertiesService.getScriptProperties().getProperty('DB_ID');
  if (!id) throw new Error('El sistema no está configurado. Ejecuta setup() en el editor.');
  memoArchivo_ = SpreadsheetApp.openById(id);
  return memoArchivo_;
}

function hoja_(nombre) {
  if (memoHojas_[nombre]) return memoHojas_[nombre];
  let sh = db_().getSheetByName(nombre);
  if (!sh && ESQUEMA[nombre]) {
    try { prepararHoja_(db_(), nombre); } catch (e) { /* otra ejecución la acaba de crear */ }
    sh = db_().getSheetByName(nombre);
  }
  if (!sh) throw new Error('Falta la hoja ' + nombre + '. Ejecuta setup() en el editor.');
  memoHojas_[nombre] = sh;
  return sh;
}

/** Lee una hoja completa con un solo getValues() y la devuelve como objetos (copias: se pueden modificar). */
function leerTabla_(nombre) {
  if (!memoTablas_[nombre]) {
    const valores = hoja_(nombre).getDataRange().getValues();
    const cab = valores.shift() || [];
    memoTablas_[nombre] = valores.map((fila, i) => {
      const o = { _fila: i + 2 };
      cab.forEach((c, j) => { o[c] = String(fila[j]); });
      return o;
    });
  }
  return memoTablas_[nombre].map(o => Object.assign({}, o));
}

function olvidarTabla_(nombre) {
  delete memoTablas_[nombre];
}

function filaDesde_(nombre, obj) {
  return ESQUEMA[nombre].map(c => (obj[c] == null ? '' : String(obj[c])));
}

/** Agrega una fila. Debe llamarse dentro de conLock_ para que dos escrituras no usen la misma fila. */
function agregarFila_(nombre, obj) {
  const sh = hoja_(nombre);
  const fila = sh.getLastRow() + 1;
  if (fila > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  sh.getRange(fila, 1, 1, ESQUEMA[nombre].length).setNumberFormat('@').setValues([filaDesde_(nombre, obj)]);
  olvidarTabla_(nombre);
  obj._fila = fila;
  return obj;
}

/** Agrega muchas filas en una sola escritura. Llamar dentro de conLock_. */
function agregarFilas_(nombre, objs) {
  if (!objs.length) return;
  olvidarTabla_(nombre);
  const sh = hoja_(nombre);
  const desde = sh.getLastRow() + 1;
  const faltan = desde + objs.length - 1 - sh.getMaxRows();
  if (faltan > 0) sh.insertRowsAfter(sh.getMaxRows(), faltan + 100);
  sh.getRange(desde, 1, objs.length, ESQUEMA[nombre].length).setNumberFormat('@')
    .setValues(objs.map(o => filaDesde_(nombre, o)));
  objs.forEach((o, i) => { o._fila = desde + i; });
}

/**
 * Reemplaza todo el contenido de una hoja (solo para datos derivados, como lo sincronizado
 * desde parrillas y fuentes de pauta). Llamar dentro de conLock_.
 */
function reescribirTabla_(nombre, objs) {
  olvidarTabla_(nombre);
  const sh = hoja_(nombre);
  const n = ESQUEMA[nombre].length;
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, n).clearContent();
  if (sh.getMaxRows() < objs.length + 1) sh.insertRowsAfter(sh.getMaxRows(), objs.length + 1 - sh.getMaxRows() + 100);
  if (objs.length) {
    sh.getRange(2, 1, objs.length, n).setNumberFormat('@').setValues(objs.map(o => filaDesde_(nombre, o)));
  }
}

/** Sobrescribe la fila de un objeto leído con leerTabla_. Las filas nunca se borran. */
function escribirFila_(nombre, obj) {
  olvidarTabla_(nombre);
  hoja_(nombre).getRange(obj._fila, 1, 1, ESQUEMA[nombre].length)
    .setNumberFormat('@').setValues([filaDesde_(nombre, obj)]);
}

function cacheJson_(clave, segundos, fn) {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get(clave);
  if (guardado) return JSON.parse(guardado);
  const valor = fn();
  try { cache.put(clave, JSON.stringify(valor), segundos); } catch (e) { /* demasiado grande para caché */ }
  return valor;
}

function invalidar_(clave) {
  CacheService.getScriptCache().remove(clave);
}

function config_() {
  return cacheJson_('config', 600, () => {
    const cfg = {};
    leerTabla_('Config').forEach(r => { cfg[r.clave] = r.valor; });
    return cfg;
  });
}

/** Valor de Config separado por comas, como lista. */
function lista_(clave) {
  return String(config_()[clave] || '').split(',').map(s => s.trim()).filter(String);
}

function usuarios_() {
  return cacheJson_('usuarios', 600, () => leerTabla_('Usuarios'));
}

function mapaNombres_() {
  const m = {};
  usuarios_().forEach(x => { m[x.id] = x.nombre; });
  return m;
}

/** Ejecuta fn con el bloqueo global para que dos personas no pisen la misma fila. */
function conLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('El sistema está ocupado, intenta de nuevo en unos segundos.');
  memoTablas_ = {}; // dentro del bloqueo se leen datos frescos
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function fmt_(fecha, patron) {
  return Utilities.formatDate(fecha, Session.getScriptTimeZone(), patron);
}

function ahora_() {
  return fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss');
}

function hoy_() {
  return fmt_(new Date(), 'yyyy-MM-dd');
}

/** Suma días a una fecha yyyy-MM-dd (a mediodía para no cruzar de día por la zona horaria). */
function sumarDias_(fecha, dias) {
  const d = new Date(fecha + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return Utilities.formatDate(d, 'GMT', 'yyyy-MM-dd');
}

function esFecha_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function esHora_(s) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function minutos_(hhmm) {
  const p = hhmm.split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

/**
 * Horario laboral de Config.horario_laboral («1-5 09:00-18:30; 6 09:00-13:00»).
 * Devuelve { día(1=lunes…7=domingo): [inicioMin, finMin] }.
 */
function horario_() {
  const h = {};
  String(config_().horario_laboral || '').split(';').map(s => s.trim()).filter(String).forEach(tramo => {
    const m = tramo.match(/^(\d)(?:-(\d))?\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/);
    if (!m) return;
    for (let d = Number(m[1]); d <= Number(m[2] || m[1]); d++) h[d] = [minutos_(m[3]), minutos_(m[4])];
  });
  return h;
}

function diaSemana_(fecha) {
  return new Date(fecha + 'T12:00:00').getDay() || 7;
}

/** Tramo laboral [ini, fin] en minutos de esa fecha, o null si es domingo, feriado o día libre. */
function tramoLaboral_(fecha, horario) {
  if (lista_('feriados').indexOf(fecha) >= 0) return null;
  return (horario || horario_())[diaSemana_(fecha)] || null;
}

/** Horas laborables entre dos fechas según el horario y los feriados. */
function horasLaborables_(desde, hasta) {
  const h = horario_();
  let total = 0;
  for (let f = desde; f <= hasta; f = sumarDias_(f, 1)) {
    const t = tramoLaboral_(f, h);
    if (t) total += (t[1] - t[0]) / 60;
  }
  return Math.round(total * 10) / 10;
}

function num_(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  // «1,316» y «1.234.567» son miles; «13.32», «1,316.50», «1.316,50» y «13,5» llevan decimales.
  const coma = s.lastIndexOf(',');
  const punto = s.lastIndexOf('.');
  let limpio;
  if (coma >= 0 && punto >= 0) limpio = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (coma >= 0) limpio = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  else limpio = /^-?\d{1,3}(\.\d{3}){2,}$/.test(s) ? s.replace(/\./g, '') : s;
  const n = Number(limpio);
  return isNaN(n) ? 0 : n;
}

/** Normaliza texto para comparar encabezados y nombres: minúsculas, sin tildes ni emojis. */
function normal_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function uuid_() {
  return Utilities.getUuid();
}

function texto_(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function escHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function opcion_(v, opciones, mensaje) {
  v = texto_(v, 100);
  if (opciones.indexOf(v) < 0) throw new Error(mensaje);
  return v;
}

/** Auditoría. Llamar dentro de conLock_. */
function log_(usuarioId, accion, idAfectado, detalle) {
  agregarFila_('Log', {
    fecha_hora: ahora_(),
    usuario: usuarioId,
    accion: accion,
    id_afectado: idAfectado || '',
    detalle: detalle || ''
  });
}

/** ¿La persona está en la lista de Config (por primer nombre)? Ej.: excluidoDe_(u, 'excluidos_eventos'). */
function excluidoDe_(u, clave) {
  const primero = s => normal_(s).split(' ')[0];
  return lista_(clave).map(primero).indexOf(primero(u.nombre)) >= 0;
}

function usuarioPorNombre_(nombre) {
  const n = normal_(nombre).split(' ')[0];
  return usuarios_().find(x => x.activo === 'SI' && normal_(x.nombre).split(' ')[0] === n) || null;
}
