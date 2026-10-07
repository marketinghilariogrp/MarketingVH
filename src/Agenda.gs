/**
 * Agenda de contenido y fechas importantes (grabaciones, publicaciones, entregables…),
 * el calendario mensual que junta eventos + tareas + agenda, y los enlaces a las parrillas.
 */

const ESTADOS_AGENDA = ['pendiente', 'hecho', 'cancelado'];

const esDeParrilla_ = a => String(a.origen).indexOf('parrilla:') === 0;

function agendaCliente_(a, u, nombres) {
  const parrilla = esDeParrilla_(a);
  return {
    id: a.id, fecha: a.fecha, hora: a.hora, titulo: a.titulo, tipo: a.tipo, marca: a.marca,
    campana: a.campana, responsable_id: a.responsable_id, responsable: nombres[a.responsable_id] || '',
    estado: a.estado, detalle: a.detalle, red: a.red, formato: a.formato, pilar: a.pilar, enlace: a.enlace,
    estado_material: a.estado_material, parrilla: parrilla,
    // Lo que viene de una parrilla se edita en su Google Sheet, no aquí.
    editable: !parrilla && esGestor_(u),
    marcable: !parrilla && (esGestor_(u) || (a.responsable_id && a.responsable_id === u.id))
  };
}

function guardarAgenda(token, d) {
  const u = sesion_(token);
  exigirGestor_(u);
  d = d || {};
  const datos = {
    fecha: texto_(d.fecha, 10),
    hora: texto_(d.hora, 5),
    titulo: texto_(d.titulo, 200),
    tipo: opcion_(d.tipo, lista_('tipos_agenda'), 'Elige el tipo.'),
    marca: d.marca ? opcion_(d.marca, lista_('marcas'), 'Marca no válida.') : '',
    campana: texto_(d.campana, 120),
    responsable_id: texto_(d.responsable_id, 40),
    detalle: texto_(d.detalle, 2000)
  };
  if (!esFecha_(datos.fecha)) throw new Error('Elige la fecha.');
  if (!datos.titulo) throw new Error('Escribe el título.');
  if (datos.hora && !esHora_(datos.hora)) throw new Error('Hora no válida.');
  if (datos.responsable_id && !usuarios_().some(x => x.id === datos.responsable_id && x.activo === 'SI')) {
    throw new Error('Responsable no válido.');
  }
  return conLock_(() => {
    let a;
    if (d.id) {
      a = leerTabla_('Agenda').find(x => x.id === d.id);
      if (!a) throw new Error('No encontrado.');
      if (esDeParrilla_(a)) throw new Error('Esta publicación viene de una parrilla: edítala en su Google Sheet.');
      Object.assign(a, datos, { actualizada: ahora_() });
      escribirFila_('Agenda', a);
    } else {
      a = Object.assign({ id: uuid_(), estado: 'pendiente', origen: 'manual', creado_por: u.id, actualizada: ahora_() }, datos);
      agregarFila_('Agenda', a);
    }
    log_(u.id, d.id ? 'editar_agenda' : 'crear_agenda', a.id, a.fecha + ' ' + a.titulo);
    return agendaCliente_(a, u, mapaNombres_());
  });
}

function estadoAgenda(token, id, estado) {
  const u = sesion_(token);
  estado = opcion_(estado, ESTADOS_AGENDA, 'Estado no válido.');
  return conLock_(() => {
    const a = leerTabla_('Agenda').find(x => x.id === id);
    if (!a) throw new Error('No encontrado.');
    if (esDeParrilla_(a)) throw new Error('Esta publicación viene de una parrilla: cambia su estado en el Google Sheet.');
    if (!esGestor_(u) && a.responsable_id !== u.id) throw new Error('No tienes permiso para esta acción.');
    a.estado = estado;
    a.actualizada = ahora_();
    escribirFila_('Agenda', a);
    log_(u.id, 'estado_agenda', a.id, estado);
    return agendaCliente_(a, u, mapaNombres_());
  });
}

/** Agenda entre dos fechas (para la vista Contenido). */
function listarAgenda(token, desde, hasta) {
  const u = sesion_(token);
  if (!esFecha_(desde) || !esFecha_(hasta)) throw new Error('Rango no válido.');
  const nombres = mapaNombres_();
  return leerTabla_('Agenda')
    .filter(a => a.fecha >= desde && a.fecha <= hasta)
    .map(a => agendaCliente_(a, u, nombres))
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
}

/** Todo lo del mes para el calendario: eventos, agenda, vencimientos de tareas y feriados. */
function getCalendario(token, mes) {
  const u = sesion_(token);
  mes = mesValido_(mes);
  const nombres = mapaNombres_();
  const enMes = f => String(f).slice(0, 7) === mes;
  return {
    mes: mes,
    eventos: eventosConPersonal_(e => enMes(e.fecha)),
    agenda: leerTabla_('Agenda').filter(a => enMes(a.fecha)).map(a => agendaCliente_(a, u, nombres)),
    tareas: leerTabla_('Tareas')
      .filter(t => enMes(t.vence) && t.estado !== 'cancelada' && (esGestor_(u) || t.usuario_id === u.id))
      .map(t => ({ id: t.id, titulo: t.titulo, vence: t.vence, estado: t.estado, marca: t.marca,
        responsable: nombres[t.usuario_id] || '—' })),
    feriados: lista_('feriados').filter(enMes)
  };
}
