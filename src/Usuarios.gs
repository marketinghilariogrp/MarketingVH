/** Gestión de usuarios. Solo el administrador crea, edita y resetea PIN. */

function listarUsuarios(token) {
  const u = sesion_(token);
  exigirGestor_(u);
  return usuarios_().map(publico_);
}

/** Crea (sin d.id) o edita (con d.id) un usuario. Al crear devuelve el PIN inicial. */
function guardarUsuario(token, d) {
  const u = sesion_(token);
  exigirAdmin_(u);
  d = d || {};

  const datos = {
    nombre: texto_(d.nombre, 100),
    correo: texto_(d.correo, 200).toLowerCase(),
    rol: texto_(d.rol, 20),
    area: texto_(d.area, 60),
    jornada_horas: Number(d.jornada_horas)
  };
  if (!datos.nombre) throw new Error('Escribe el nombre.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) throw new Error('El correo no es válido.');
  if (ROLES.indexOf(datos.rol) < 0) throw new Error('Rol no válido.');
  if (!(datos.jornada_horas > 0 && datos.jornada_horas <= 24)) throw new Error('La jornada debe estar entre 1 y 24 horas.');

  return conLock_(() => {
    const todos = leerTabla_('Usuarios');
    if (todos.some(x => x.correo.toLowerCase() === datos.correo && x.id !== d.id)) {
      throw new Error('Ya existe un usuario con ese correo.');
    }

    if (d.id) {
      const fila = todos.find(x => x.id === d.id);
      if (!fila) throw new Error('Usuario no encontrado.');
      const activo = d.activo ? 'SI' : 'NO';
      if (fila.id === u.id && (datos.rol !== 'admin' || activo !== 'SI')) {
        throw new Error('No puedes quitarte el rol de administrador ni desactivarte a ti mismo.');
      }
      Object.assign(fila, datos, { activo: activo });
      escribirFila_('Usuarios', fila);
      invalidar_('usuarios');
      log_(u.id, 'editar_usuario', fila.id, datos.rol + ' / ' + activo);
      return { usuario: publico_(fila) };
    }

    const nuevo = Object.assign({ id: uuid_(), activo: 'SI', creado: ahora_() }, datos);
    const pin = generarPin_();
    nuevo.pin_hash = hashPin_(nuevo.id, pin);
    agregarFila_('Usuarios', nuevo);
    invalidar_('usuarios');
    log_(u.id, 'crear_usuario', nuevo.id, datos.rol);
    return { usuario: publico_(nuevo), pin: pin };
  });
}

function resetearPin(token, id) {
  const u = sesion_(token);
  exigirAdmin_(u);
  return conLock_(() => {
    const fila = leerTabla_('Usuarios').find(x => x.id === id);
    if (!fila) throw new Error('Usuario no encontrado.');
    const pin = generarPin_();
    fila.pin_hash = hashPin_(fila.id, pin);
    escribirFila_('Usuarios', fila);
    invalidar_('usuarios');
    CacheService.getScriptCache().remove('intentos_' + fila.correo.toLowerCase());
    log_(u.id, 'resetear_pin', fila.id);
    return { pin: pin };
  });
}
