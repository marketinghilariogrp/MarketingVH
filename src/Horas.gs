/**
 * Registro de horas por función (diseño, audiovisual, CM, pauta, eventos…).
 * Lo usan todos; los practicantes lo usan como su control de horas.
 */

const DIAS_EDICION_HORAS = 7;

function registrarHoras(token, d) {
  const u = sesion_(token);
  d = d || {};
  const r = {
    id: uuid_(),
    usuario_id: u.id,
    fecha: texto_(d.fecha, 10),
    inicio: texto_(d.inicio, 5),
    fin: texto_(d.fin, 5),
    funcion: opcion_(d.funcion, lista_('funciones'), 'Elige la función.'),
    marca: d.marca ? opcion_(d.marca, lista_('marcas'), 'Marca no válida.') : '',
    tarea_id: texto_(d.tarea_id, 40),
    descripcion: texto_(d.descripcion, 500),
    creado: ahora_(),
    estado: 'activo'
  };
  // Un gestor puede registrar horas a nombre de otra persona.
  if (d.usuario_id && d.usuario_id !== u.id) {
    exigirGestor_(u);
    if (!usuarios_().some(x => x.id === d.usuario_id && x.activo === 'SI')) throw new Error('Persona no válida.');
    r.usuario_id = d.usuario_id;
  }
  const hoy = hoy_();
  if (!esFecha_(r.fecha) || r.fecha > hoy) throw new Error('La fecha no puede ser futura.');
  if (!esGestor_(u) && r.fecha < sumarDias_(hoy, -DIAS_EDICION_HORAS)) {
    throw new Error('Solo puedes registrar horas de los últimos ' + DIAS_EDICION_HORAS + ' días.');
  }
  if (!esHora_(r.inicio) || !esHora_(r.fin)) throw new Error('Escribe la hora de inicio y de fin.');
  const ini = minutos_(r.inicio);
  const fin = minutos_(r.fin);
  if (fin <= ini) throw new Error('La hora de fin debe ser mayor que la de inicio.');
  r.horas = String(Math.round((fin - ini) / 60 * 100) / 100);

  return conLock_(() => {
    const cruce = leerTabla_('Horas').find(x => x.usuario_id === r.usuario_id && x.fecha === r.fecha &&
      x.estado === 'activo' && minutos_(x.inicio) < fin && ini < minutos_(x.fin));
    if (cruce) throw new Error('Se cruza con otro registro de ese día (' + cruce.inicio + '–' + cruce.fin + ').');
    agregarFila_('Horas', r);
    log_(u.id, 'registrar_horas', r.id, r.fecha + ' ' + r.horas + 'h ' + r.funcion);
    return horaCliente_(r, u, mapaNombres_());
  });
}

function anularHoras(token, id) {
  const u = sesion_(token);
  return conLock_(() => {
    const r = leerTabla_('Horas').find(x => x.id === id);
    if (!r || r.estado !== 'activo') throw new Error('Registro no encontrado.');
    if (!esGestor_(u)) {
      if (r.usuario_id !== u.id) throw new Error('No puedes anular horas de otra persona.');
      if (r.fecha < sumarDias_(hoy_(), -DIAS_EDICION_HORAS)) throw new Error('Este registro ya no se puede anular.');
    }
    r.estado = 'anulado';
    escribirFila_('Horas', r);
    log_(u.id, 'anular_horas', r.id, r.fecha + ' ' + r.horas + 'h');
    return true;
  });
}

function horaCliente_(r, u, nombres) {
  const puedeAnular = esGestor_(u) || (r.usuario_id === u.id && r.fecha >= sumarDias_(hoy_(), -DIAS_EDICION_HORAS));
  return {
    id: r.id, usuario_id: r.usuario_id, persona: nombres[r.usuario_id] || '—', fecha: r.fecha,
    inicio: r.inicio, fin: r.fin, horas: Number(r.horas) || 0, funcion: r.funcion, marca: r.marca,
    descripcion: r.descripcion, anulable: puedeAnular
  };
}

/** Registros y resumen de horas del rango. Un colaborador solo ve los suyos. */
function listarHoras(token, desde, hasta, usuarioId) {
  const u = sesion_(token);
  desde = texto_(desde, 10);
  hasta = texto_(hasta, 10);
  if (!esFecha_(desde) || !esFecha_(hasta) || desde > hasta) throw new Error('Rango de fechas no válido.');
  if (!esGestor_(u)) usuarioId = u.id;

  const nombres = mapaNombres_();
  const registros = leerTabla_('Horas').filter(r => r.estado === 'activo' && r.fecha >= desde && r.fecha <= hasta &&
    (!usuarioId || r.usuario_id === usuarioId));

  const porFuncion = {};
  const porPersona = {};
  registros.forEach(r => {
    const h = Number(r.horas) || 0;
    porFuncion[r.funcion] = (porFuncion[r.funcion] || 0) + h;
    porPersona[r.usuario_id] = (porPersona[r.usuario_id] || 0) + h;
  });

  // Capacidad = horas del horario laboral (Config.horario_laboral) hasta hoy, sin feriados.
  const capacidad = horasLaborables_(desde, hasta > hoy_() ? hoy_() : hasta);
  const personas = usuarios_()
    .filter(x => x.activo === 'SI' && (!usuarioId || x.id === usuarioId) && (porPersona[x.id] || x.rol !== 'admin'))
    .map(x => {
      const horas = Math.round((porPersona[x.id] || 0) * 100) / 100;
      return { usuario_id: x.id, nombre: x.nombre, rol: x.rol, area: x.area, horas: horas,
        capacidad: capacidad, uso: capacidad ? Math.round(horas / capacidad * 100) : null };
    })
    .sort((a, b) => b.horas - a.horas);

  return {
    registros: registros.map(r => horaCliente_(r, u, nombres))
      .sort((a, b) => (b.fecha + b.inicio).localeCompare(a.fecha + a.inicio)),
    porFuncion: Object.keys(porFuncion).map(k => ({ k: k, v: Math.round(porFuncion[k] * 100) / 100 }))
      .sort((a, b) => b.v - a.v),
    personas: personas,
    horasLaborables: capacidad
  };
}
