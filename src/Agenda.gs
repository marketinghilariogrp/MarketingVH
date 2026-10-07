/**
 * Agenda de contenido y fechas importantes (grabaciones, publicaciones, entregables…),
 * el calendario mensual que junta eventos + tareas + agenda, y los enlaces a las parrillas.
 */

const ESTADOS_AGENDA = ['pendiente', 'hecho', 'cancelado'];
const RECORDATORIOS = ['0', '10', '30', '60', '120', '1440']; // minutos antes

const esDeParrilla_ = a => String(a.origen).indexOf('parrilla:') === 0;

/**
 * Visibilidad: lo privado (agenda personal) solo lo ve quien lo creó; lo del equipo lo ven todos.
 * Lo eliminado no lo ve nadie.
 */
function agendaVisible_(a, u) {
  return a.estado !== 'eliminado' && (a.privado !== 'SI' || a.creado_por === u.id);
}

function agendaCliente_(a, u, nombres) {
  const parrilla = esDeParrilla_(a);
  const privado = a.privado === 'SI';
  const mio = a.creado_por === u.id;
  return {
    id: a.id, fecha: a.fecha, hora: a.hora, titulo: a.titulo, tipo: a.tipo, marca: a.marca,
    campana: a.campana, responsable_id: a.responsable_id, responsable: nombres[a.responsable_id] || '',
    estado: a.estado, detalle: a.detalle, red: a.red, formato: a.formato, pilar: a.pilar, enlace: a.enlace,
    estado_material: a.estado_material, parrilla: parrilla, privado: privado,
    recordatorio_min: a.recordatorio_min,
    // Lo que viene de una parrilla se edita en su Google Sheet, no aquí.
    editable: !parrilla && (u.rol === 'admin' || (privado ? mio : esGestor_(u))),
    eliminable: !parrilla && (u.rol === 'admin' || mio),
    marcable: !parrilla && (mio || a.responsable_id === u.id || (!privado && esGestor_(u)))
  };
}

/** Momento del recordatorio (yyyy-MM-dd HH:mm:ss) o '' si no hay. */
function momentoRecordatorio_(fecha, hora, minutos) {
  if (minutos === '' || minutos == null || !hora) return '';
  const d = new Date(fecha + 'T' + hora + ':00');
  return fmt_(new Date(d.getTime() - Number(minutos) * 60000), 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Crea o edita un elemento de la agenda.
 * - Coordinación/admin: elementos del equipo (grabaciones, entregables…) o personales («Solo para mí»).
 * - Los demás: solo su agenda personal (reuniones, recordatorios…), que nadie más ve.
 */
function guardarAgenda(token, d) {
  const u = sesion_(token);
  d = d || {};
  const gestor = esGestor_(u);
  const privado = !gestor || !!d.privado;
  const tipos = privado ? lista_('tipos_agenda_personal').concat(gestor ? lista_('tipos_agenda') : []) : lista_('tipos_agenda');
  const datos = {
    fecha: texto_(d.fecha, 10),
    hora: texto_(d.hora, 5),
    titulo: texto_(d.titulo, 200),
    tipo: opcion_(d.tipo, tipos, 'Elige el tipo.'),
    marca: d.marca ? opcion_(d.marca, lista_('marcas'), 'Marca no válida.') : '',
    campana: texto_(d.campana, 120),
    responsable_id: privado ? u.id : texto_(d.responsable_id, 40),
    detalle: texto_(d.detalle, 2000),
    privado: privado ? 'SI' : 'NO',
    recordatorio_min: d.recordatorio_min === '' || d.recordatorio_min == null ? '' : opcion_(String(d.recordatorio_min), RECORDATORIOS, 'Recordatorio no válido.')
  };
  if (!esFecha_(datos.fecha)) throw new Error('Elige la fecha.');
  if (!datos.titulo) throw new Error('Escribe el título.');
  if (datos.hora && !esHora_(datos.hora)) throw new Error('Hora no válida.');
  if (datos.recordatorio_min !== '' && !datos.hora) throw new Error('Para poner un recordatorio indica la hora.');
  if (datos.responsable_id && !usuarios_().some(x => x.id === datos.responsable_id && x.activo === 'SI')) {
    throw new Error('Responsable no válido.');
  }
  datos.recordar_en = momentoRecordatorio_(datos.fecha, datos.hora, datos.recordatorio_min);
  datos.recordado = datos.recordar_en && datos.recordar_en <= ahora_() ? 'SI' : 'NO';
  return conLock_(() => {
    let a;
    if (d.id) {
      a = leerTabla_('Agenda').find(x => x.id === d.id);
      if (!a || a.estado === 'eliminado') throw new Error('No encontrado.');
      if (esDeParrilla_(a)) throw new Error('Esta publicación viene de una parrilla: edítala en su Google Sheet.');
      if (!agendaCliente_(a, u, {}).editable) throw new Error('No tienes permiso para editar esto.');
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
    if (!a || !agendaVisible_(a, u)) throw new Error('No encontrado.');
    if (esDeParrilla_(a)) throw new Error('Esta publicación viene de una parrilla: cambia su estado en el Google Sheet.');
    if (!agendaCliente_(a, u, {}).marcable) throw new Error('No tienes permiso para esta acción.');
    a.estado = estado;
    a.actualizada = ahora_();
    escribirFila_('Agenda', a);
    log_(u.id, 'estado_agenda', a.id, estado);
    return agendaCliente_(a, u, mapaNombres_());
  });
}

/** Elimina un elemento de la agenda (el admin cualquiera; cada persona lo que creó). */
function eliminarAgenda(token, id) {
  const u = sesion_(token);
  return conLock_(() => {
    const a = leerTabla_('Agenda').find(x => x.id === id);
    if (!a || !agendaVisible_(a, u)) throw new Error('No encontrado.');
    if (!agendaCliente_(a, u, {}).eliminable) throw new Error('No tienes permiso para eliminar esto.');
    a.estado = 'eliminado';
    a.actualizada = ahora_();
    escribirFila_('Agenda', a);
    log_(u.id, 'eliminar_agenda', a.id, a.fecha + ' ' + a.titulo);
    return true;
  });
}

/** Agenda entre dos fechas (para la vista Contenido). */
function listarAgenda(token, desde, hasta) {
  const u = sesion_(token);
  if (!esFecha_(desde) || !esFecha_(hasta)) throw new Error('Rango no válido.');
  const nombres = mapaNombres_();
  return leerTabla_('Agenda')
    .filter(a => a.fecha >= desde && a.fecha <= hasta && agendaVisible_(a, u))
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
    eventos: adjuntarAlquiler_(eventosConPersonal_(e => enMes(e.fecha)), u),
    agenda: leerTabla_('Agenda').filter(a => enMes(a.fecha) && agendaVisible_(a, u)).map(a => agendaCliente_(a, u, nombres)),
    tareas: leerTabla_('Tareas')
      .filter(t => enMes(t.vence) && t.estado !== 'cancelada' && t.estado !== 'eliminada' && (esGestor_(u) || t.usuario_id === u.id))
      .map(t => ({ id: t.id, titulo: t.titulo, vence: t.vence, estado: t.estado, marca: t.marca,
        responsable: nombres[t.usuario_id] || '—' })),
    feriados: lista_('feriados').filter(enMes),
    eliminable: u.rol === 'admin'
  };
}
