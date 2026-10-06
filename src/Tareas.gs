/**
 * Tareas: crear, editar y mover de estado.
 * El colaborador solo puede llevar su tarea hasta «revisión»; aprobar es del admin
 * (y de la coordinación si Config.coordinador_puede_aprobar = SI).
 */

const PRIORIDADES = ['alta', 'media', 'baja'];

// quien: responsable = la persona asignada o un gestor; gestor = admin o coordinador;
// aprobador = admin o coordinador con permiso en Config; admin = solo admin.
const TRANSICIONES = {
  pendiente: [
    { a: 'en_progreso', quien: 'responsable', etiqueta: 'Empezar' },
    { a: 'cancelada', quien: 'gestor', etiqueta: 'Cancelar', confirmar: true }
  ],
  en_progreso: [
    { a: 'revision', quien: 'responsable', etiqueta: 'Enviar a revisión' },
    { a: 'pendiente', quien: 'responsable', etiqueta: 'Volver a pendiente' },
    { a: 'cancelada', quien: 'gestor', etiqueta: 'Cancelar', confirmar: true }
  ],
  revision: [
    { a: 'aprobada', quien: 'aprobador', etiqueta: 'Aprobar' },
    { a: 'en_progreso', quien: 'gestor', etiqueta: 'Devolver', nota: true }
  ],
  aprobada: [
    { a: 'revision', quien: 'admin', etiqueta: 'Reabrir', confirmar: true }
  ],
  cancelada: [
    { a: 'pendiente', quien: 'gestor', etiqueta: 'Reactivar' }
  ]
};

const DIAS_HISTORIAL = 30;

function puede_(u, quien, t, cfg) {
  switch (quien) {
    case 'responsable': return esGestor_(u) || t.usuario_id === u.id;
    case 'gestor': return esGestor_(u);
    case 'aprobador': return u.rol === 'admin' || (u.rol === 'coordinador' && cfg.coordinador_puede_aprobar === 'SI');
    case 'admin': return u.rol === 'admin';
  }
  return false;
}

function tareaCliente_(t, u, cfg, nombres) {
  return {
    id: t.id,
    titulo: t.titulo,
    descripcion: t.descripcion,
    usuario_id: t.usuario_id,
    responsable: nombres[t.usuario_id] || '—',
    creada_por: nombres[t.creada_por] || '—',
    prioridad: t.prioridad,
    estado: t.estado,
    creada: t.creada,
    vence: t.vence,
    completada: t.completada,
    nota: t.nota,
    acciones: (TRANSICIONES[t.estado] || [])
      .filter(tr => puede_(u, tr.quien, t, cfg))
      .map(tr => ({ a: tr.a, etiqueta: tr.etiqueta, nota: !!tr.nota, confirmar: !!tr.confirmar })),
    editable: esGestor_(u) && ['pendiente', 'en_progreso', 'revision'].indexOf(t.estado) >= 0
  };
}

function mapaNombres_() {
  const m = {};
  usuarios_().forEach(x => { m[x.id] = x.nombre; });
  return m;
}

/** Tareas visibles para el usuario: abiertas + cerradas en los últimos 30 días. */
function tareasPara_(u) {
  const cfg = config_();
  const nombres = mapaNombres_();
  const limite = Utilities.formatDate(new Date(Date.now() - DIAS_HISTORIAL * 864e5),
    Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return leerTabla_('Tareas')
    .filter(t => esGestor_(u) || t.usuario_id === u.id)
    .filter(t => {
      if (t.estado === 'aprobada') return t.completada >= limite;
      if (t.estado === 'cancelada') return t.actualizada >= limite;
      return true;
    })
    .map(t => tareaCliente_(t, u, cfg, nombres));
}

function listarTareas(token) {
  const u = sesion_(token);
  return { hoy: hoy_(), tareas: tareasPara_(u) };
}

function validarTarea_(d) {
  const datos = {
    titulo: texto_(d.titulo, 200),
    descripcion: texto_(d.descripcion, 2000),
    usuario_id: texto_(d.usuario_id, 40),
    prioridad: texto_(d.prioridad, 10),
    vence: texto_(d.vence, 10)
  };
  if (!datos.titulo) throw new Error('Escribe el título de la tarea.');
  if (PRIORIDADES.indexOf(datos.prioridad) < 0) throw new Error('Prioridad no válida.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.vence)) throw new Error('Elige la fecha límite.');
  const responsable = usuarios_().find(x => x.id === datos.usuario_id && x.activo === 'SI');
  if (!responsable) throw new Error('Elige a la persona responsable.');
  datos.peso = config_()['peso_' + datos.prioridad] || '1';
  return datos;
}

function buscarTarea_(id) {
  const t = leerTabla_('Tareas').find(x => x.id === id);
  if (!t) throw new Error('Tarea no encontrada.');
  return t;
}

function crearTarea(token, d) {
  const u = sesion_(token);
  exigirGestor_(u);
  const datos = validarTarea_(d || {});
  return conLock_(() => {
    const ahora = ahora_();
    const t = Object.assign({
      id: uuid_(), creada_por: u.id, estado: 'pendiente', creada: ahora,
      completada: '', nota: '', actualizada: ahora
    }, datos);
    agregarFila_('Tareas', t);
    log_(u.id, 'crear_tarea', t.id, t.titulo);
    return tareaCliente_(t, u, config_(), mapaNombres_());
  });
}

function editarTarea(token, d) {
  const u = sesion_(token);
  exigirGestor_(u);
  const datos = validarTarea_(d || {});
  return conLock_(() => {
    const t = buscarTarea_(d.id);
    if (['pendiente', 'en_progreso', 'revision'].indexOf(t.estado) < 0) {
      throw new Error('Solo se pueden editar tareas abiertas.');
    }
    Object.assign(t, datos, { actualizada: ahora_() });
    escribirFila_('Tareas', t);
    log_(u.id, 'editar_tarea', t.id, t.titulo);
    return tareaCliente_(t, u, config_(), mapaNombres_());
  });
}

function moverTarea(token, id, estado, nota) {
  const u = sesion_(token);
  const cfg = config_();
  return conLock_(() => {
    const t = buscarTarea_(id);
    if (!esGestor_(u) && t.usuario_id !== u.id) throw new Error('No tienes acceso a esta tarea.');

    const tr = (TRANSICIONES[t.estado] || []).find(x => x.a === estado);
    if (!tr || !puede_(u, tr.quien, t, cfg)) throw new Error('Ese cambio de estado no está permitido.');

    nota = texto_(nota, 1000);
    if (tr.nota && !nota) throw new Error('Escribe el motivo de la devolución.');

    const antes = t.estado;
    t.estado = estado;
    if (estado === 'aprobada') {
      t.completada = ahora_();
      t.nota = '';
    } else if (antes === 'aprobada') {
      t.completada = '';
    }
    if (nota) t.nota = nota;
    t.actualizada = ahora_();

    escribirFila_('Tareas', t);
    log_(u.id, 'estado_tarea', t.id, antes + ' → ' + estado + (nota ? ' · ' + nota : ''));
    return tareaCliente_(t, u, cfg, mapaNombres_());
  });
}
