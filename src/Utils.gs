/**
 * Utilidades compartidas: acceso a la base, lecturas en bloque, caché, bloqueo y log.
 * Todos los valores se guardan como texto para que Sheets no los convierta solo.
 */

const ESQUEMA = {
  Usuarios: ['id', 'nombre', 'correo', 'rol', 'area', 'pin_hash', 'jornada_horas', 'activo', 'creado'],
  Tareas: ['id', 'titulo', 'descripcion', 'usuario_id', 'creada_por', 'prioridad', 'estado',
    'creada', 'vence', 'completada', 'peso', 'nota', 'actualizada'],
  Asistencia: ['id', 'usuario_id', 'fecha', 'entrada', 'salida', 'tipo_dia', 'horas', 'extra'],
  Ajustes_saldo: ['id', 'usuario_id', 'fecha', 'motivo', 'tipo', 'cantidad'],
  Eventos: ['id', 'fecha', 'titulo', 'detalle', 'lugar', 'calendar_id', 'estado'],
  Cobertura: ['id', 'evento_id', 'usuario_id', 'rol_en_evento', 'estado'],
  Resumen_mensual: ['mes', 'usuario_id', 'tareas_ok', 'a_tiempo', 'horas_extra', 'eventos', 'saldo'],
  Config: ['clave', 'valor', 'descripcion'],
  Log: ['fecha_hora', 'usuario', 'accion', 'id_afectado', 'detalle']
};

function db_() {
  const id = PropertiesService.getScriptProperties().getProperty('DB_ID');
  if (!id) throw new Error('El sistema no está configurado. Ejecuta setup() en el editor.');
  return SpreadsheetApp.openById(id);
}

function hoja_(nombre) {
  const sh = db_().getSheetByName(nombre);
  if (!sh) throw new Error('Falta la hoja ' + nombre + '. Ejecuta setup() en el editor.');
  return sh;
}

/** Lee una hoja completa con un solo getValues() y la devuelve como objetos. */
function leerTabla_(nombre) {
  const valores = hoja_(nombre).getDataRange().getValues();
  const cab = valores.shift() || [];
  return valores.map((fila, i) => {
    const o = { _fila: i + 2 };
    cab.forEach((c, j) => { o[c] = String(fila[j]); });
    return o;
  });
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
  obj._fila = fila;
  return obj;
}

/** Sobrescribe la fila de un objeto leído con leerTabla_. Las filas nunca se borran. */
function escribirFila_(nombre, obj) {
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

function usuarios_() {
  return cacheJson_('usuarios', 600, () => leerTabla_('Usuarios'));
}

/** Ejecuta fn con el bloqueo global para que dos personas no pisen la misma fila. */
function conLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('El sistema está ocupado, intenta de nuevo en unos segundos.');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function ahora_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function hoy_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function uuid_() {
  return Utilities.getUuid();
}

function texto_(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
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
