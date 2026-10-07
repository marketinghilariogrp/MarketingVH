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
    { a: 'pausada', quien: 'responsable', etiqueta: 'Pausar', nota: true, motivo: 'Escribe el motivo de la pausa.' },
    { a: 'pendiente', quien: 'responsable', etiqueta: 'Volver a pendiente' },
    { a: 'cancelada', quien: 'gestor', etiqueta: 'Cancelar', confirmar: true }
  ],
  pausada: [
    { a: 'en_progreso', quien: 'responsable', etiqueta: 'Reanudar' },
    { a: 'cancelada', quien: 'gestor', etiqueta: 'Cancelar', confirmar: true }
  ],
  revision: [
    { a: 'aprobada', quien: 'aprobador', etiqueta: 'Aprobar' },
    { a: 'en_progreso', quien: 'gestor', etiqueta: 'Devolver', nota: true, motivo: 'Escribe el motivo de la devolución.' }
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

/** hist: historial de la tarea (solo se envía al admin, para medir tiempos). */
function tareaCliente_(t, u, cfg, nombres, hist) {
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
    pausa_motivo: t.estado === 'pausada' ? t.pausa_motivo : '',
    tiempos: u.rol === 'admin' && hist ? tiemposTarea_(hist, t.estado) : null,
    marca: t.marca,
    campana: t.campana,
    pieza: t.pieza,
    tipo: t.tipo,
    acciones: (TRANSICIONES[t.estado] || [])
      .filter(tr => puede_(u, tr.quien, t, cfg))
      .map(tr => ({ a: tr.a, etiqueta: tr.etiqueta, nota: !!tr.nota, confirmar: !!tr.confirmar })),
    editable: esGestor_(u) && ['pendiente', 'en_progreso', 'pausada', 'revision'].indexOf(t.estado) >= 0,
    archivable: esGestor_(u) && t.estado === 'aprobada' && t.archivada !== 'SI',
    eliminable: u.rol === 'admin',
    peso: Number(t.peso) || 0
  };
}

/** Tareas visibles para el usuario: abiertas + cerradas en los últimos 30 días. */
function tareasPara_(u) {
  const cfg = config_();
  const nombres = mapaNombres_();
  const hist = historialPorTarea_(u);
  const limite = Utilities.formatDate(new Date(Date.now() - DIAS_HISTORIAL * 864e5),
    Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return leerTabla_('Tareas')
    .filter(t => esGestor_(u) || t.usuario_id === u.id)
    .filter(t => t.estado !== 'eliminada' && t.archivada !== 'SI')
    .filter(t => {
      if (t.estado === 'aprobada') return t.completada >= limite;
      if (t.estado === 'cancelada') return t.actualizada >= limite;
      return true;
    })
    .map(t => tareaCliente_(t, u, cfg, nombres, hist ? hist[t.id] || [] : null));
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
    vence: texto_(d.vence, 10),
    campana: texto_(d.campana, 120),
    pieza: texto_(d.pieza, 200)
  };
  if (!datos.titulo) throw new Error('Escribe el título de la tarea.');
  if (PRIORIDADES.indexOf(datos.prioridad) < 0) throw new Error('Prioridad no válida.');
  if (!esFecha_(datos.vence)) throw new Error('Elige la fecha límite.');
  datos.marca = opcion_(d.marca, lista_('marcas'), 'Elige la marca.');
  datos.tipo = opcion_(d.tipo, lista_('funciones'), 'Elige el tipo de trabajo.');
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
    const t = crearTareaInterna_(u, datos, '');
    return tareaCliente_(t, u, config_(), mapaNombres_());
  });
}

/** Crea la fila de la tarea. Llamar dentro de conLock_ con datos ya validados. */
function crearTareaInterna_(u, datos, solicitudId) {
  const ahora = ahora_();
  const t = Object.assign({
    id: uuid_(), creada_por: u.id, estado: 'pendiente', creada: ahora,
    completada: '', nota: '', actualizada: ahora, solicitud_id: solicitudId
  }, datos);
  agregarFila_('Tareas', t);
  registrarHistorial_(t.id, u.id, '', 'pendiente', '');
  log_(u.id, 'crear_tarea', t.id, t.titulo);
  return t;
}

function editarTarea(token, d) {
  const u = sesion_(token);
  exigirGestor_(u);
  const datos = validarTarea_(d || {});
  return conLock_(() => {
    const t = buscarTarea_(d.id);
    if (['pendiente', 'en_progreso', 'pausada', 'revision'].indexOf(t.estado) < 0) {
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
    if (tr.nota && !nota) throw new Error(tr.motivo || 'Escribe el motivo.');

    const antes = t.estado;
    t.estado = estado;
    if (estado === 'aprobada') {
      t.completada = ahora_();
      t.nota = '';
    } else if (antes === 'aprobada') {
      t.completada = '';
    }
    // El motivo de la pausa se guarda aparte; la nota es solo para devoluciones.
    if (estado === 'pausada') t.pausa_motivo = nota;
    else {
      t.pausa_motivo = '';
      if (nota) t.nota = nota;
    }
    t.actualizada = ahora_();

    escribirFila_('Tareas', t);
    registrarHistorial_(t.id, u.id, antes, estado, nota);
    log_(u.id, 'estado_tarea', t.id, antes + ' → ' + estado + (nota ? ' · ' + nota : ''));
    const hist = u.rol === 'admin' ? leerTabla_('Tareas_historial').filter(h => h.tarea_id === t.id) : null;
    return tareaCliente_(t, u, cfg, mapaNombres_(), hist);
  });
}

/* ---------- Histórico y limpieza ---------- */

/** Envía al histórico una tarea aprobada, o todas las aprobadas si id === '*' (coordinación/admin). */
function archivarTareas(token, id) {
  const u = sesion_(token);
  exigirGestor_(u);
  return conLock_(() => {
    const lista = leerTabla_('Tareas').filter(t => t.estado === 'aprobada' && t.archivada !== 'SI' && (id === '*' || t.id === id));
    if (!lista.length) throw new Error('No hay tareas aprobadas para enviar al histórico.');
    lista.forEach(t => { t.archivada = 'SI'; t.actualizada = ahora_(); escribirFila_('Tareas', t); });
    log_(u.id, 'archivar_tareas', id, lista.length + ' tareas');
    return lista.length;
  });
}

/** Elimina una tarea creada por error o de prueba (solo admin). No cuenta en producción ni informes. */
function eliminarTarea(token, id) {
  const u = sesion_(token);
  exigirAdmin_(u);
  return conLock_(() => {
    const t = buscarTarea_(id);
    t.estado = 'eliminada';
    t.actualizada = ahora_();
    escribirFila_('Tareas', t);
    log_(u.id, 'eliminar_tarea', t.id, t.titulo);
    return true;
  });
}

/**
 * Histórico: tareas aprobadas (en el histórico o no) con fecha de aprobación en el rango.
 * Coordinación/admin ven a todos (o a una persona); los demás solo lo suyo.
 */
function listarHistorico(token, desde, hasta, usuarioId) {
  const u = sesion_(token);
  exigirGestor_(u);
  if (!esFecha_(desde) || !esFecha_(hasta)) throw new Error('Rango de fechas no válido.');
  if (!esGestor_(u)) usuarioId = u.id;
  const cfg = config_();
  const nombres = mapaNombres_();
  const hist = historialPorTarea_(u);
  const tareas = leerTabla_('Tareas').filter(t => t.estado === 'aprobada' &&
    t.completada.slice(0, 10) >= desde && t.completada.slice(0, 10) <= hasta && (!usuarioId || t.usuario_id === usuarioId));
  const porPersona = {};
  tareas.forEach(t => {
    const p = porPersona[t.usuario_id] = porPersona[t.usuario_id] || { usuario_id: t.usuario_id, nombre: nombres[t.usuario_id] || '—', tareas: 0, peso: 0, aTiempo: 0 };
    p.tareas++;
    p.peso += Number(t.peso) || 0;
    if (t.completada.slice(0, 10) <= t.vence) p.aTiempo++;
  });
  return {
    tareas: tareas.map(t => tareaCliente_(t, u, cfg, nombres, hist ? hist[t.id] || [] : null)).sort((a, b) => b.completada.localeCompare(a.completada)),
    personas: Object.keys(porPersona).map(k => {
      const p = porPersona[k];
      p.pctATiempo = p.tareas ? Math.round(p.aTiempo / p.tareas * 100) : null;
      return p;
    }).sort((a, b) => b.peso - a.peso)
  };
}

/* ---------- Historial de acciones y tiempos (inicio, trabajo efectivo, pausas) ---------- */

/** Registra un cambio de estado con fecha y hora. Llamar dentro de conLock_. */
function registrarHistorial_(tareaId, usuarioId, desde, hasta, motivo) {
  agregarFila_('Tareas_historial', { id: uuid_(), tarea_id: tareaId, usuario_id: usuarioId, fecha_hora: ahora_(),
    desde: desde, hasta: hasta, motivo: motivo || '' });
}

/** { tarea_id: [cambios ordenados] } — solo para el admin (los demás no reciben tiempos). */
function historialPorTarea_(u) {
  if (u.rol !== 'admin') return null;
  const m = {};
  leerTabla_('Tareas_historial').forEach(h => { (m[h.tarea_id] = m[h.tarea_id] || []).push(h); });
  return m;
}

function minutosDelDia_(fh) {
  return Number(fh.slice(11, 13)) * 60 + Number(fh.slice(14, 16));
}

/** Minutos entre dos momentos (yyyy-MM-dd HH:mm:ss) que caen dentro del horario laboral. */
function minutosLaborables_(desde, hasta) {
  if (!desde || !hasta || hasta <= desde) return 0;
  const h = horario_();
  let total = 0;
  for (let f = desde.slice(0, 10); f <= hasta.slice(0, 10); f = sumarDias_(f, 1)) {
    const tramo = tramoLaboral_(f, h);
    if (!tramo) continue;
    const ini = f === desde.slice(0, 10) ? Math.max(tramo[0], minutosDelDia_(desde)) : tramo[0];
    const fin = f === hasta.slice(0, 10) ? Math.min(tramo[1], minutosDelDia_(hasta)) : tramo[1];
    if (fin > ini) total += fin - ini;
  }
  return total;
}

/**
 * Tiempos de una tarea a partir de su historial:
 * - inicio: primera vez que pasó a «en progreso»
 * - efectivo: minutos «en progreso» dentro del horario laboral
 * - pausado: minutos «en pausa» dentro del horario laboral (y cuántas pausas)
 * - entrega: última vez que se envió a revisión
 * Si la tarea sigue en progreso o en pausa, se cuenta hasta ahora.
 */
function tiemposTarea_(hist, estadoActual) {
  const h = (hist || []).slice().sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));
  const inicio = (h.find(x => x.hasta === 'en_progreso') || {}).fecha_hora || '';
  if (!inicio) return { inicio: '', entrega: '', efectivo: 0, pausado: 0, pausas: 0 };
  let efectivo = 0;
  let pausado = 0;
  h.forEach((x, i) => {
    const fin = h[i + 1] ? h[i + 1].fecha_hora : (['en_progreso', 'pausada'].indexOf(estadoActual) >= 0 ? ahora_() : x.fecha_hora);
    if (x.hasta === 'en_progreso') efectivo += minutosLaborables_(x.fecha_hora, fin);
    if (x.hasta === 'pausada') pausado += minutosLaborables_(x.fecha_hora, fin);
  });
  const envios = h.filter(x => x.hasta === 'revision');
  return {
    inicio: inicio,
    entrega: envios.length ? envios[envios.length - 1].fecha_hora : '',
    efectivo: efectivo,
    pausado: pausado,
    pausas: h.filter(x => x.hasta === 'pausada').length
  };
}

/** Todas las acciones de una tarea, con persona, fecha y hora (solo admin). */
function getHistorialTarea(token, id) {
  const u = sesion_(token);
  exigirAdmin_(u);
  const t = buscarTarea_(id);
  const nombres = mapaNombres_();
  const hist = leerTabla_('Tareas_historial').filter(h => h.tarea_id === id).sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));
  return {
    titulo: t.titulo,
    responsable: nombres[t.usuario_id] || '—',
    tiempos: tiemposTarea_(hist, t.estado),
    acciones: hist.map(h => ({ fecha_hora: h.fecha_hora, persona: nombres[h.usuario_id] || '—', desde: h.desde, hasta: h.hasta, motivo: h.motivo }))
  };
}
