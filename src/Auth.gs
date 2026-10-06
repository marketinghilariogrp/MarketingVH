/**
 * Login con correo + PIN (los correos son Gmail personales, así que no se usa Session.getActiveUser).
 * El PIN se guarda como hash y la sesión es un token temporal en CacheService.
 */

const ROLES = ['admin', 'coordinador', 'colaborador'];
const DURACION_SESION = 21600; // 6 horas, máximo que permite CacheService
const MAX_INTENTOS = 5;

function hashPin_(usuarioId, pin) {
  const sal = PropertiesService.getScriptProperties().getProperty('SALT');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    sal + ':' + usuarioId + ':' + pin, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function generarPin_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function validarPin_(pin) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('El PIN debe tener entre 4 y 8 números.');
}

function login(correo, pin) {
  correo = texto_(correo, 200).toLowerCase();
  pin = texto_(pin, 20);
  if (!correo || !/^\d{4,8}$/.test(pin)) throw new Error('Correo o PIN incorrecto.');

  const cache = CacheService.getScriptCache();
  const claveIntentos = 'intentos_' + correo;
  const intentos = Number(cache.get(claveIntentos) || 0);
  if (intentos >= MAX_INTENTOS) throw new Error('Demasiados intentos fallidos. Espera 15 minutos.');

  const u = usuarios_().find(x => x.correo.toLowerCase() === correo && x.activo === 'SI');
  if (!u || hashPin_(u.id, pin) !== u.pin_hash) {
    cache.put(claveIntentos, String(intentos + 1), 900);
    throw new Error('Correo o PIN incorrecto.');
  }
  cache.remove(claveIntentos);

  const token = uuid_();
  cache.put('tok_' + token, u.id, DURACION_SESION);
  conLock_(() => log_(u.id, 'login', u.id));
  return { token: token };
}

function logout(token) {
  if (typeof token === 'string') CacheService.getScriptCache().remove('tok_' + token);
}

/** Devuelve el usuario dueño del token o lanza SESION_EXPIRADA. Renueva la sesión en cada uso. */
function sesion_(token) {
  const cache = CacheService.getScriptCache();
  const id = typeof token === 'string' && /^[0-9a-f-]{36}$/.test(token) ? cache.get('tok_' + token) : null;
  if (!id) throw new Error('SESION_EXPIRADA');
  const u = usuarios_().find(x => x.id === id);
  if (!u || u.activo !== 'SI') {
    cache.remove('tok_' + token);
    throw new Error('SESION_EXPIRADA');
  }
  cache.put('tok_' + token, id, DURACION_SESION);
  return u;
}

function esGestor_(u) {
  return u.rol === 'admin' || u.rol === 'coordinador';
}

function exigirGestor_(u) {
  if (!esGestor_(u)) throw new Error('No tienes permiso para esta acción.');
}

function exigirAdmin_(u) {
  if (u.rol !== 'admin') throw new Error('Solo el administrador puede hacer esto.');
}

function publico_(u) {
  return {
    id: u.id,
    nombre: u.nombre,
    correo: u.correo,
    rol: u.rol,
    area: u.area,
    jornada_horas: Number(u.jornada_horas) || 0,
    activo: u.activo === 'SI'
  };
}

function cambiarMiPin(token, actual, nuevo) {
  const u = sesion_(token);
  actual = texto_(actual, 20);
  nuevo = texto_(nuevo, 20);
  validarPin_(nuevo);
  conLock_(() => {
    const fila = leerTabla_('Usuarios').find(x => x.id === u.id);
    if (hashPin_(fila.id, actual) !== fila.pin_hash) throw new Error('El PIN actual no es correcto.');
    fila.pin_hash = hashPin_(fila.id, nuevo);
    escribirFila_('Usuarios', fila);
    invalidar_('usuarios');
    log_(u.id, 'cambiar_pin', u.id);
  });
  return true;
}
