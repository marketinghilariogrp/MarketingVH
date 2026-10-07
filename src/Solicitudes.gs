/**
 * Solo coordinación y admin (los colaboradores no ven esta sección).
 * Solicitudes internas: cualquiera pide una pieza (diseño, edición, pauta, contenido…);
 * la coordinación la asigna (se convierte en tarea) o la rechaza con motivo.
 */

function solicitudCliente_(s, nombres, tareas) {
  const t = s.tarea_id ? tareas[s.tarea_id] : null;
  return {
    id: s.id, titulo: s.titulo, descripcion: s.descripcion, tipo: s.tipo, marca: s.marca,
    solicitante: nombres[s.solicitante_id] || '—', solicitante_id: s.solicitante_id,
    prioridad: s.prioridad, fecha_entrega: s.fecha_entrega, estado: s.estado, nota: s.nota,
    creada: s.creada,
    tarea: t ? { id: t.id, estado: t.estado, responsable: nombres[t.usuario_id] || '—' } : null
  };
}

function listarSolicitudes(token) {
  const u = sesion_(token);
  exigirGestor_(u);
  const nombres = mapaNombres_();
  const tareas = {};
  leerTabla_('Tareas').forEach(t => { tareas[t.id] = t; });
  const limite = sumarDias_(hoy_(), -60);
  return leerTabla_('Solicitudes')
    .filter(s => esGestor_(u) || s.solicitante_id === u.id)
    .filter(s => s.estado === 'nueva' || s.actualizada >= limite)
    .map(s => solicitudCliente_(s, nombres, tareas))
    .reverse();
}

function crearSolicitud(token, d) {
  const u = sesion_(token);
  exigirGestor_(u);
  d = d || {};
  const s = {
    id: uuid_(),
    titulo: texto_(d.titulo, 200),
    descripcion: texto_(d.descripcion, 2000),
    tipo: opcion_(d.tipo, lista_('funciones'), 'Elige el tipo de trabajo.'),
    marca: opcion_(d.marca, lista_('marcas'), 'Elige la marca.'),
    solicitante_id: u.id,
    prioridad: opcion_(d.prioridad, PRIORIDADES, 'Prioridad no válida.'),
    fecha_entrega: texto_(d.fecha_entrega, 10),
    estado: 'nueva', tarea_id: '', creada: ahora_(), actualizada: ahora_(), nota: ''
  };
  if (!s.titulo) throw new Error('Escribe qué necesitas.');
  if (!esFecha_(s.fecha_entrega)) throw new Error('Elige la fecha de entrega.');
  conLock_(() => {
    agregarFila_('Solicitudes', s);
    log_(u.id, 'crear_solicitud', s.id, s.titulo);
  });
  return solicitudCliente_(s, mapaNombres_(), {});
}

/** Asigna la solicitud a una persona: crea la tarea con los mismos datos. */
function asignarSolicitud(token, id, usuarioId) {
  const u = sesion_(token);
  exigirGestor_(u);
  return conLock_(() => {
    const s = leerTabla_('Solicitudes').find(x => x.id === id);
    if (!s) throw new Error('Solicitud no encontrada.');
    if (s.estado !== 'nueva') throw new Error('Esta solicitud ya fue atendida.');
    const datos = validarTarea_({
      titulo: s.titulo, descripcion: s.descripcion, usuario_id: usuarioId, prioridad: s.prioridad,
      vence: s.fecha_entrega, marca: s.marca, tipo: s.tipo,
      pieza: s.titulo, campana: ''
    });
    const t = crearTareaInterna_(u, datos, s.id);
    Object.assign(s, { estado: 'asignada', tarea_id: t.id, actualizada: ahora_() });
    escribirFila_('Solicitudes', s);
    log_(u.id, 'asignar_solicitud', s.id, t.id);
    const tareas = {};
    tareas[t.id] = t;
    return solicitudCliente_(s, mapaNombres_(), tareas);
  });
}

function rechazarSolicitud(token, id, nota) {
  const u = sesion_(token);
  exigirGestor_(u);
  nota = texto_(nota, 1000);
  if (!nota) throw new Error('Escribe el motivo.');
  return conLock_(() => {
    const s = leerTabla_('Solicitudes').find(x => x.id === id);
    if (!s) throw new Error('Solicitud no encontrada.');
    if (s.estado !== 'nueva') throw new Error('Esta solicitud ya fue atendida.');
    Object.assign(s, { estado: 'rechazada', nota: nota, actualizada: ahora_() });
    escribirFila_('Solicitudes', s);
    log_(u.id, 'rechazar_solicitud', s.id, nota);
    return solicitudCliente_(s, mapaNombres_(), {});
  });
}
