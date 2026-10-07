/**
 * Horas y sobretiempo: cada persona marca su hora de ingreso y de salida por día.
 * - Personal con horario (L–V 9:00–18:30, sáb 9:00–13:00): sobretiempo = lo trabajado fuera del horario.
 * - Practicantes: 25 h a la semana en días flexibles; sobretiempo = lo que pase de 25 h en la semana.
 * El sobretiempo es «compensable» si ese día la persona estaba asignada a un evento (cubrió un evento);
 * si no, es «no compensable» y la coordinación decide si corresponde (p. ej., se le pidió quedarse).
 * No marcan: el admin y las personas de Config.excluidos_horas (home office).
 */

function marcaHoras_(u) {
  return u.activo === 'SI' && u.rol !== 'admin' && !excluidoDe_(u, 'excluidos_horas');
}

function lunesDe_(fecha) {
  return sumarDias_(fecha, 1 - diaSemana_(fecha));
}

/** Minutos trabajados [ini, fin] de un registro; la salida antes que la entrada se toma como del día siguiente. */
function tramoRegistro_(r) {
  if (!esHora_(r.entrada) || !esHora_(r.salida)) return null;
  const ini = minutos_(r.entrada);
  let fin = minutos_(r.salida);
  if (fin <= ini) fin += 1440;
  return [ini, fin];
}

/** Semana de una persona (lunes a domingo) con sus marcaciones. */
function getMiSemana(token, lunes, usuarioId) {
  const u = sesion_(token);
  const gestor = esGestor_(u);
  const hoy = hoy_();
  let persona = u;
  if (gestor && usuarioId && usuarioId !== u.id) {
    persona = usuarios_().find(x => x.id === usuarioId);
    if (!persona) throw new Error('Persona no válida.');
  }
  if (!marcaHoras_(persona)) {
    return { marca: false, mensaje: persona.id === u.id ? 'Tu perfil no lleva registro de horas.' : persona.nombre + ' no lleva registro de horas.' };
  }
  // Los colaboradores solo ven y marcan la semana actual; la coordinación puede revisar otras.
  lunes = gestor && esFecha_(lunes) ? lunesDe_(lunes) : lunesDe_(hoy);
  const domingo = sumarDias_(lunes, 6);
  const registros = leerTabla_('Asistencia').filter(r => r.usuario_id === persona.id && r.fecha >= lunes && r.fecha <= domingo);
  const calc = calcularAsistencia_(registros, lunes, domingo);
  const resumen = calc.personas.find(p => p.usuario_id === persona.id) || { horas: 0, compensable: 0, noCompensable: 0 };
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const f = sumarDias_(lunes, i);
    const r = registros.find(x => x.fecha === f) || {};
    const fila = calc.filas.find(x => x.fecha === f) || {};
    dias.push({ fecha: f, entrada: r.entrada || '', salida: r.salida || '', horas: fila.horas || 0, eventos: fila.eventos || [],
      laborable: !!tramoLaboral_(f), feriado: lista_('feriados').indexOf(f) >= 0,
      editable: gestor || (f <= hoy && f >= lunesDe_(hoy)) });
  }
  return {
    marca: true, persona: { id: persona.id, nombre: persona.nombre, practicante: persona.rol === 'practicante' },
    lunes: lunes, dias: dias, resumen: resumen,
    horasSemanaPracticante: Number(config_().horas_semana_practicante) || 25
  };
}

/** Guarda la entrada y/o salida de un día (crea o actualiza). Dejar ambas vacías borra la marcación. */
function marcarAsistencia(token, d) {
  const u = sesion_(token);
  d = d || {};
  const gestor = esGestor_(u);
  let persona = u;
  if (d.usuario_id && d.usuario_id !== u.id) {
    exigirGestor_(u);
    persona = usuarios_().find(x => x.id === d.usuario_id);
  }
  if (!persona || !marcaHoras_(persona)) throw new Error('Esta persona no lleva registro de horas.');
  const fecha = texto_(d.fecha, 10);
  const entrada = texto_(d.entrada, 5);
  const salida = texto_(d.salida, 5);
  const hoy = hoy_();
  if (!esFecha_(fecha) || fecha > hoy) throw new Error('No se pueden marcar días futuros.');
  if (!gestor && fecha < lunesDe_(hoy)) throw new Error('Solo puedes marcar la semana actual. Pide a coordinación que corrija semanas anteriores.');
  if ((entrada && !esHora_(entrada)) || (salida && !esHora_(salida))) throw new Error('Hora no válida.');
  if (salida && !entrada) throw new Error('Primero marca la hora de ingreso.');
  if (entrada && salida && minutos_(salida) <= minutos_(entrada) && minutos_(salida) > 6 * 60) {
    throw new Error('La salida debe ser después del ingreso (si saliste pasada la medianoche, usa una hora antes de las 6:00).');
  }
  return conLock_(() => {
    const r = leerTabla_('Asistencia').find(x => x.usuario_id === persona.id && x.fecha === fecha);
    if (r) {
      Object.assign(r, { entrada: entrada, salida: salida, actualizado: ahora_(), nota: gestor && persona.id !== u.id ? 'Corregido por ' + u.nombre : r.nota });
      escribirFila_('Asistencia', r);
    } else if (entrada) {
      agregarFila_('Asistencia', { id: uuid_(), usuario_id: persona.id, fecha: fecha, entrada: entrada, salida: salida,
        tipo_dia: '', horas: '', extra: '', actualizado: ahora_(), nota: gestor && persona.id !== u.id ? 'Registrado por ' + u.nombre : '' });
    }
    log_(u.id, 'marcar_asistencia', persona.id, fecha + ' ' + entrada + '–' + salida);
  });
  // Se devuelve la semana actualizada para no tener que volver a pedirla.
  return getMiSemana(token, lunesDe_(fecha), persona.id === u.id ? '' : persona.id);
}

/**
 * Calcula horas y sobretiempo de los registros. Devuelve filas por día y resumen por persona.
 * Los practicantes se calculan por semana completa (lunes a domingo).
 */
function calcularAsistencia_(registros, desde, hasta) {
  const usuarios = {};
  usuarios_().forEach(x => { usuarios[x.id] = x; });
  const meta = (Number(config_().horas_semana_practicante) || 25) * 60;
  // Eventos por persona y día (asignado o cubierto, no ausente; evento no cancelado).
  const eventos = {};
  eventosConPersonal_(e => e.fecha >= sumarDias_(desde, -7) && e.fecha <= sumarDias_(hasta, 7) && e.estado !== 'cancelado')
    .forEach(e => e.personal.filter(p => p.estado !== 'ausente').forEach(p => {
      (eventos[p.usuario_id + '|' + e.fecha] = eventos[p.usuario_id + '|' + e.fecha] || []).push(e.titulo + ' (' + e.empresa + ')');
    }));

  const r2 = n => Math.round(n / 60 * 100) / 100;
  const filas = [];
  const semanas = {}; // practicantes: usuario|lunes → { min, minEvento }
  registros.forEach(r => {
    const u = usuarios[r.usuario_id];
    if (!u) return;
    const t = tramoRegistro_(r);
    const ev = eventos[r.usuario_id + '|' + r.fecha] || [];
    const fila = { usuario_id: r.usuario_id, nombre: u.nombre, practicante: u.rol === 'practicante', fecha: r.fecha,
      entrada: r.entrada, salida: r.salida, horas: 0, compensable: 0, noCompensable: 0, eventos: ev, nota: r.nota, incompleto: !t };
    if (t) {
      const min = t[1] - t[0];
      fila.horas = r2(min);
      if (u.rol === 'practicante') {
        const k = r.usuario_id + '|' + lunesDe_(r.fecha);
        const s = semanas[k] = semanas[k] || { usuario_id: r.usuario_id, lunes: lunesDe_(r.fecha), min: 0, minEvento: 0 };
        s.min += min;
        if (ev.length) s.minEvento += min;
      } else {
        const extra = Math.max(0, minutosExtra_(r.fecha, t[0], t[1]));
        if (ev.length) fila.compensable = r2(extra); else fila.noCompensable = r2(extra);
      }
    }
    filas.push(fila);
  });

  const personas = {};
  const p = id => (personas[id] = personas[id] || { usuario_id: id, nombre: (usuarios[id] || {}).nombre || '—',
    practicante: (usuarios[id] || {}).rol === 'practicante', dias: 0, horas: 0, compensable: 0, noCompensable: 0 });
  filas.filter(f => f.fecha >= desde && f.fecha <= hasta).forEach(f => {
    const x = p(f.usuario_id);
    x.dias++;
    x.horas += f.horas;
    x.compensable += f.compensable;
    x.noCompensable += f.noCompensable;
  });
  // Practicantes: lo que pase de 25 h por semana; compensable hasta lo trabajado en días de evento.
  const resumenSemanas = Object.keys(semanas).map(k => {
    const s = semanas[k];
    const extra = Math.max(0, s.min - meta);
    const comp = Math.min(extra, s.minEvento);
    const x = { usuario_id: s.usuario_id, nombre: usuarios[s.usuario_id].nombre, lunes: s.lunes, horas: r2(s.min),
      compensable: r2(comp), noCompensable: r2(extra - comp) };
    if (s.lunes >= lunesDe_(desde) && s.lunes <= hasta) {
      const y = p(s.usuario_id);
      y.compensable += x.compensable;
      y.noCompensable += x.noCompensable;
    }
    return x;
  });
  const red = n => Math.round(n * 100) / 100;
  return {
    filas: filas.filter(f => f.fecha >= desde && f.fecha <= hasta).sort((a, b) => (b.fecha + a.nombre).localeCompare(a.fecha + b.nombre)),
    semanasPracticantes: resumenSemanas.sort((a, b) => b.lunes.localeCompare(a.lunes)),
    personas: Object.keys(personas).map(k => {
      const x = personas[k];
      return Object.assign(x, { horas: red(x.horas), compensable: red(x.compensable), noCompensable: red(x.noCompensable) });
    })
  };
}

/** Tabla del equipo (coordinación/admin): marcaciones, sobretiempo compensable y no compensable, compensaciones. */
function getAsistenciaEquipo(token, desde, hasta, usuarioId) {
  const u = sesion_(token);
  exigirGestor_(u);
  if (!esFecha_(desde) || !esFecha_(hasta) || desde > hasta) throw new Error('Rango de fechas no válido.');
  const incluye = x => marcaHoras_(x) && (!usuarioId || x.id === usuarioId);
  const ids = usuarios_().filter(incluye).map(x => x.id);
  // Se leen semanas completas para calcular bien a los practicantes.
  const registros = leerTabla_('Asistencia').filter(r => ids.indexOf(r.usuario_id) >= 0 && r.fecha >= lunesDe_(desde) && r.fecha <= sumarDias_(lunesDe_(hasta), 6));
  const calc = calcularAsistencia_(registros, desde, hasta);
  const nombres = mapaNombres_();
  const compensaciones = leerTabla_('Ajustes_saldo').filter(c => ids.indexOf(c.usuario_id) >= 0);
  const compensado = {};
  compensaciones.forEach(c => { compensado[c.usuario_id] = (compensado[c.usuario_id] || 0) + Math.abs(Number(c.cantidad) || 0); });

  // Saldo histórico total (todo el tiempo) de sobretiempo compensable − compensado.
  const todo = calcularAsistencia_(leerTabla_('Asistencia').filter(r => ids.indexOf(r.usuario_id) >= 0), '2000-01-01', hoy_());
  const personas = usuarios_().filter(incluye).map(x => {
    const enRango = calc.personas.find(p => p.usuario_id === x.id) || { dias: 0, horas: 0, compensable: 0, noCompensable: 0 };
    const total = todo.personas.find(p => p.usuario_id === x.id) || { compensable: 0 };
    return Object.assign({ usuario_id: x.id, nombre: x.nombre, practicante: x.rol === 'practicante' }, enRango, {
      compensado: Math.round((compensado[x.id] || 0) * 100) / 100,
      saldo: Math.round((total.compensable - (compensado[x.id] || 0)) * 100) / 100
    });
  });
  return {
    filas: calc.filas,
    semanasPracticantes: calc.semanasPracticantes.filter(s => s.lunes <= hasta && sumarDias_(s.lunes, 6) >= desde),
    personas: personas,
    compensaciones: compensaciones.map(c => ({ persona: nombres[c.usuario_id] || '—', fecha: c.fecha, tipo: c.tipo,
      horas: Math.abs(Number(c.cantidad) || 0), motivo: c.motivo })).sort((a, b) => b.fecha.localeCompare(a.fecha)),
    tiposCompensacion: TIPOS_COMPENSACION,
    horasSemanaPracticante: Number(config_().horas_semana_practicante) || 25
  };
}
