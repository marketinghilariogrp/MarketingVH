/**
 * Pantalla de inicio: KPIs, gráficas resumidas y alertas automáticas.
 * Las mismas alertas se envían por correo cada mañana (trigger alertasDiarias).
 */

const ABIERTAS = ['pendiente', 'en_progreso', 'pausada', 'revision'];

/** Lista de alertas. Si u es null (trigger) se calculan las del equipo completo. */
function alertas_(u, datos) {
  const hoy = hoy_();
  const gestor = !u || esGestor_(u);
  const nombres = mapaNombres_();
  const cfg = config_();
  const al = [];
  const add = (nivel, texto, vista) => al.push({ nivel: nivel, texto: texto, vista: vista });

  const misTareas = datos.tareas.filter(t => ABIERTAS.indexOf(t.estado) >= 0 && (gestor || t.usuario_id === u.id));
  misTareas.filter(t => t.vence && t.vence < hoy).forEach(t =>
    add('alta', 'Tarea vencida: «' + t.titulo + '»' + (gestor ? ' · ' + (nombres[t.usuario_id] || '—') : '') +
      ' (venció ' + t.vence + ')', 'tareas'));
  misTareas.filter(t => t.vence === hoy && t.estado !== 'revision').forEach(t =>
    add('media', 'Vence hoy: «' + t.titulo + '»' + (gestor ? ' · ' + (nombres[t.usuario_id] || '—') : ''), 'tareas'));

  if (gestor) {
    const limiteSol = sumarDias_(hoy, -1);
    datos.solicitudes.filter(s => s.estado === 'nueva').forEach(s =>
      add(s.creada.slice(0, 10) <= limiteSol ? 'alta' : 'media',
        'Solicitud sin asignar: «' + s.titulo + '» de ' + (nombres[s.solicitante_id] || '—'), 'solicitudes'));

    const max = Number(cfg.max_tareas_abiertas) || 8;
    const carga = {};
    datos.tareas.filter(t => ABIERTAS.indexOf(t.estado) >= 0).forEach(t => { carga[t.usuario_id] = (carga[t.usuario_id] || 0) + 1; });
    Object.keys(carga).filter(id => carga[id] > max).forEach(id =>
      add('media', 'Posible sobrecarga: ' + (nombres[id] || '—') + ' tiene ' + carga[id] + ' tareas abiertas', 'equipo'));

    // Tareas parecidas abiertas en dos personas (posible duplicidad).
    const vistos = {};
    datos.tareas.filter(t => ABIERTAS.indexOf(t.estado) >= 0).forEach(t => {
      const k = (t.marca + '|' + t.titulo).toLowerCase().replace(/\s+/g, ' ').trim();
      if (vistos[k] && vistos[k] !== t.usuario_id) {
        add('media', 'Posible tarea duplicada: «' + t.titulo + '» (' + (nombres[vistos[k]] || '—') + ' y ' + (nombres[t.usuario_id] || '—') + ')', 'tareas');
      }
      vistos[k] = t.usuario_id;
    });

    const en7 = sumarDias_(hoy, 7);
    datos.eventos.filter(e => e.estado === 'programado' && e.fecha >= hoy && e.fecha <= en7 && !e.personal.length).forEach(e =>
      add('alta', 'Evento sin personal asignado: «' + e.titulo + '» el ' + e.fecha, 'eventos'));
    datos.eventos.filter(e => e.estado === 'programado' && e.fecha < hoy).forEach(e =>
      add('media', 'Evento pasado sin cerrar: «' + e.titulo + '» (' + e.fecha + '). Márcalo como realizado o cancelado.', 'eventos'));
  }

  const hace14 = sumarDias_(hoy, -14);
  datos.agenda.filter(a => a.estado === 'pendiente' && a.fecha < hoy && a.fecha >= hace14 &&
    (a.privado === 'SI' ? (u && a.creado_por === u.id) : (gestor || (u && a.responsable_id === u.id)))).forEach(a =>
    add('alta', a.tipo + ' no ejecutada: «' + a.titulo + '»' + (a.marca ? ' · ' + a.marca : '') + ' (' + a.fecha + ')', 'contenido'));

  if (gestor) {
    try { alertasPauta_().forEach(t => add('media', 'Pauta · ' + t, 'informes')); } catch (e) { /* sin datos de pauta */ }
    const extra = leerTabla_('Sobretiempo').filter(s => s.estado === 'pendiente');
    if (extra.length) add('media', extra.length + ' registros de sobretiempo esperan aprobación', 'sobretiempo');
  }
  return al.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'alta' ? -1 : 1));
}

function datosBase_() {
  return {
    tareas: leerTabla_('Tareas'),
    solicitudes: leerTabla_('Solicitudes'),
    agenda: leerTabla_('Agenda'),
    eventos: eventosConPersonal_(e => e.fecha >= sumarDias_(hoy_(), -45) && e.estado !== 'cancelado')
  };
}

function getDashboard(token) {
  const u = sesion_(token);
  const gestor = esGestor_(u);
  const hoy = hoy_();
  const mes = hoy.slice(0, 7);
  const datos = datosBase_();
  const nombres = mapaNombres_();

  // Semana actual (lunes a hoy).
  const dow = new Date(hoy + 'T12:00:00').getDay() || 7;
  const lunes = sumarDias_(hoy, 1 - dow);
  // Horas desde las marcaciones de ingreso/salida.
  const asistencia = leerTabla_('Asistencia').filter(r => gestor || r.usuario_id === u.id);
  const calcSemana = calcularAsistencia_(asistencia.filter(r => r.fecha >= lunes), lunes, hoy);
  const horasSemana = Math.round(calcSemana.personas.reduce((s, x) => s + x.horas, 0) * 10) / 10;
  const calcMes = calcularAsistencia_(asistencia.filter(r => r.fecha >= lunesDe_(mes + '-01')), mes + '-01', hoy);

  const tareas = datos.tareas.filter(t => gestor || t.usuario_id === u.id);
  const abiertas = tareas.filter(t => ABIERTAS.indexOf(t.estado) >= 0);
  const eventosMes = datos.eventos.filter(e => e.fecha.slice(0, 7) === mes);
  const misEventosMes = gestor ? eventosMes : eventosMes.filter(e => e.personal.some(p => p.usuario_id === u.id));

  const kpis = [
    { etiqueta: gestor ? 'Tareas abiertas' : 'Mis pendientes', valor: abiertas.length, vista: 'tareas' },
    { etiqueta: 'Vencidas', valor: abiertas.filter(t => t.vence && t.vence < hoy).length, tono: 'alerta', vista: 'tareas' },
    { etiqueta: 'En revisión', valor: abiertas.filter(t => t.estado === 'revision').length, vista: 'tareas' },
    { etiqueta: gestor ? 'Eventos del mes' : 'Mis eventos del mes', valor: misEventosMes.length, vista: 'eventos' },
    { etiqueta: gestor ? 'Horas del equipo (semana)' : 'Mis horas (semana)', valor: horasSemana, vista: 'asistencia' }
  ];
  if (gestor) {
    kpis.splice(3, 0, { etiqueta: 'Solicitudes nuevas', valor: datos.solicitudes.filter(s => s.estado === 'nueva').length, vista: 'solicitudes' });
  }

  // Producción del mes: suma de pesos de tareas aprobadas, y % a tiempo.
  const aprobadasMes = tareas.filter(t => t.estado === 'aprobada' && t.completada.slice(0, 7) === mes);
  const prod = {};
  aprobadasMes.forEach(t => { prod[t.usuario_id] = (prod[t.usuario_id] || 0) + (Number(t.peso) || 1); });
  const aTiempo = aprobadasMes.filter(t => t.completada.slice(0, 10) <= t.vence).length;


  const proximos = datos.eventos
    .filter(e => e.fecha >= hoy && e.estado === 'programado' && (gestor || e.personal.some(p => p.usuario_id === u.id)))
    .slice(0, 6)
    .map(e => ({ fecha: e.fecha, titulo: e.titulo, empresa: e.empresa, hora: e.hora_inicio,
      personal: e.personal.map(p => p.nombre + ' (' + p.funcion + ')') }));

  return {
    hoy: hoy,
    kpis: kpis,
    alertas: alertas_(u, datos),
    cumplimiento: aprobadasMes.length ? Math.round(aTiempo / aprobadasMes.length * 100) : null,
    produccion: Object.keys(prod).map(id => ({ k: nombres[id] || '—', v: prod[id] })).sort((a, b) => b.v - a.v),
    // Sobretiempo del mes por persona: compensable (cubrió evento) y no compensable.
    sobretiempoMes: calcMes.personas.filter(x => x.compensable || x.noCompensable)
      .map(x => ({ nombre: x.nombre, compensable: x.compensable, noCompensable: x.noCompensable }))
      .sort((a, b) => (b.compensable + b.noCompensable) - (a.compensable + a.noCompensable)),
    eventosPorPersona: gestor ? conteoEventos_(eventosMes).filter(x => x.eventos > 0) : [],
    proximos: proximos
  };
}

/** Trigger diario (8:00 a. m.): envía las alertas del equipo a los correos de reporte. */
function alertasDiarias() {
  const destinatarios = lista_('correos_reporte').join(',');
  if (!destinatarios) return;
  const al = alertas_(null, datosBase_());
  if (!al.length) return;
  const html = '<h2 style="font-family:sans-serif">MarketingVH · Alertas del ' + hoy_() + '</h2><ul style="font-family:sans-serif">' +
    al.map(a => '<li' + (a.nivel === 'alta' ? ' style="color:#b91c1c"' : '') + '>' + escHtml_(a.texto) + '</li>').join('') + '</ul>';
  MailApp.sendEmail({ to: destinatarios, subject: 'MarketingVH · ' + al.length + ' alertas para hoy', htmlBody: html });
}
