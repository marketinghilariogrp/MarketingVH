/**
 * Sobretiempo (horas extra): cada persona registra el tramo que trabajó fuera de su horario;
 * la coordinación o el admin lo aprueba; el admin registra las compensaciones (día libre, horas, pago).
 * Saldo = horas aprobadas − horas compensadas. Las horas extra se calculan solo con la parte que
 * cae fuera del horario laboral (Config.horario_laboral); domingos y feriados cuentan completos.
 */

const TIPOS_COMPENSACION = ['Día libre', 'Horas libres', 'Pago'];

/** Minutos del tramo [ini, fin] que caen fuera del horario laboral de esa fecha. */
function minutosExtra_(fecha, ini, fin) {
  const t = tramoLaboral_(fecha);
  if (!t) return fin - ini;
  const dentro = Math.max(0, Math.min(fin, t[1]) - Math.max(ini, t[0]));
  return (fin - ini) - dentro;
}

function registrarSobretiempo(token, d) {
  const u = sesion_(token);
  d = d || {};
  const r = {
    id: uuid_(),
    usuario_id: u.id,
    fecha: texto_(d.fecha, 10),
    inicio: texto_(d.inicio, 5),
    fin: texto_(d.fin, 5),
    motivo: texto_(d.motivo, 500),
    evento_id: texto_(d.evento_id, 40),
    estado: 'pendiente', revisado_por: '', nota: '', creado: ahora_()
  };
  if (d.usuario_id && d.usuario_id !== u.id) {
    exigirGestor_(u);
    if (!usuarios_().some(x => x.id === d.usuario_id && x.activo === 'SI')) throw new Error('Persona no válida.');
    r.usuario_id = d.usuario_id;
  }
  if (!esFecha_(r.fecha) || r.fecha > hoy_()) throw new Error('La fecha no puede ser futura.');
  if (!esHora_(r.inicio) || !esHora_(r.fin)) throw new Error('Escribe la hora de inicio y de fin.');
  if (!r.motivo && !r.evento_id) throw new Error('Indica el motivo o el evento.');
  const ini = minutos_(r.inicio);
  let fin = minutos_(r.fin);
  if (fin <= ini) fin += 24 * 60; // pasó la medianoche
  const extra = minutosExtra_(r.fecha, ini, fin);
  if (extra <= 0) throw new Error('Ese horario está dentro de la jornada laboral; no genera horas extra.');
  r.horas = String(Math.round(extra / 60 * 100) / 100);
  // Un gestor que registra para otra persona puede aprobar en el mismo paso.
  if (esGestor_(u) && r.usuario_id !== u.id && d.aprobar) {
    r.estado = 'aprobado';
    r.revisado_por = u.id;
  }

  return conLock_(() => {
    const cruce = leerTabla_('Sobretiempo').find(x => x.usuario_id === r.usuario_id && x.fecha === r.fecha &&
      x.estado !== 'rechazado' && minutos_(x.inicio) < fin && ini < (minutos_(x.fin) <= minutos_(x.inicio) ? minutos_(x.fin) + 1440 : minutos_(x.fin)));
    if (cruce) throw new Error('Ya hay un registro de sobretiempo que se cruza (' + cruce.inicio + '–' + cruce.fin + ').');
    agregarFila_('Sobretiempo', r);
    log_(u.id, 'registrar_sobretiempo', r.id, r.fecha + ' ' + r.horas + 'h');
    return { horas: Number(r.horas), estado: r.estado };
  });
}

function revisarSobretiempo(token, id, estado, nota) {
  const u = sesion_(token);
  exigirGestor_(u);
  estado = opcion_(estado, ['aprobado', 'rechazado'], 'Estado no válido.');
  nota = texto_(nota, 500);
  if (estado === 'rechazado' && !nota) throw new Error('Escribe el motivo del rechazo.');
  return conLock_(() => {
    const r = leerTabla_('Sobretiempo').find(x => x.id === id);
    if (!r) throw new Error('Registro no encontrado.');
    if (r.usuario_id === u.id && u.rol !== 'admin') throw new Error('No puedes aprobar tus propias horas extra.');
    Object.assign(r, { estado: estado, revisado_por: u.id, nota: nota });
    escribirFila_('Sobretiempo', r);
    log_(u.id, 'revisar_sobretiempo', r.id, estado);
    return true;
  });
}

function registrarCompensacion(token, d) {
  const u = sesion_(token);
  exigirAdmin_(u);
  d = d || {};
  const horas = Number(d.horas);
  const c = {
    id: uuid_(),
    usuario_id: texto_(d.usuario_id, 40),
    fecha: texto_(d.fecha, 10),
    motivo: texto_(d.motivo, 500),
    tipo: opcion_(d.tipo, TIPOS_COMPENSACION, 'Elige el tipo de compensación.'),
    cantidad: String(-Math.abs(horas)),
    registrado_por: u.id,
    creado: ahora_()
  };
  if (!usuarios_().some(x => x.id === c.usuario_id)) throw new Error('Elige a la persona.');
  if (!esFecha_(c.fecha)) throw new Error('Elige la fecha.');
  if (!(horas > 0 && horas <= 200)) throw new Error('Indica cuántas horas se compensan.');
  return conLock_(() => {
    agregarFila_('Ajustes_saldo', c);
    log_(u.id, 'compensar_sobretiempo', c.id, c.tipo + ' ' + horas + 'h');
    return true;
  });
}

/** Registros, compensaciones y saldos. El colaborador solo ve lo suyo. */
function getSobretiempo(token) {
  const u = sesion_(token);
  const gestor = esGestor_(u);
  const nombres = mapaNombres_();
  const ver = x => gestor || x.usuario_id === u.id;
  const registros = leerTabla_('Sobretiempo').filter(ver);
  const compensaciones = leerTabla_('Ajustes_saldo').filter(ver);

  const saldos = {};
  const s = id => (saldos[id] = saldos[id] || { usuario_id: id, nombre: nombres[id] || '—', aprobadas: 0, pendientes: 0, compensadas: 0 });
  registros.forEach(r => {
    if (r.estado === 'aprobado') s(r.usuario_id).aprobadas += Number(r.horas) || 0;
    if (r.estado === 'pendiente') s(r.usuario_id).pendientes += Number(r.horas) || 0;
  });
  compensaciones.forEach(c => { s(c.usuario_id).compensadas += Math.abs(Number(c.cantidad) || 0); });
  const r2 = n => Math.round(n * 100) / 100;

  // Eventos recientes para vincular (últimos 30 días; el colaborador solo ve los suyos).
  const desde = sumarDias_(hoy_(), -30);
  const eventos = eventosConPersonal_(e => e.fecha >= desde && e.fecha <= hoy_() && e.estado !== 'cancelado')
    .filter(e => gestor || e.personal.some(p => p.usuario_id === u.id))
    .map(e => ({ id: e.id, fecha: e.fecha, titulo: e.titulo, empresa: e.empresa }));
  const titulos = {};
  leerTabla_('Eventos').forEach(e => { titulos[e.id] = e.fecha + ' · ' + e.titulo; });

  return {
    saldos: Object.keys(saldos).map(id => {
      const x = saldos[id];
      return Object.assign(x, { aprobadas: r2(x.aprobadas), pendientes: r2(x.pendientes), compensadas: r2(x.compensadas),
        saldo: r2(x.aprobadas - x.compensadas) });
    }).sort((a, b) => b.saldo - a.saldo),
    registros: registros.map(r => ({
      id: r.id, usuario_id: r.usuario_id, persona: nombres[r.usuario_id] || '—', fecha: r.fecha, inicio: r.inicio, fin: r.fin,
      horas: Number(r.horas) || 0, motivo: r.motivo, evento: titulos[r.evento_id] || '', estado: r.estado, nota: r.nota,
      revisor: nombres[r.revisado_por] || '',
      revisable: gestor && r.estado === 'pendiente' && (r.usuario_id !== u.id || u.rol === 'admin')
    })).sort((a, b) => (b.fecha + b.inicio).localeCompare(a.fecha + a.inicio)),
    compensaciones: compensaciones.map(c => ({
      persona: nombres[c.usuario_id] || '—', fecha: c.fecha, tipo: c.tipo, horas: Math.abs(Number(c.cantidad) || 0), motivo: c.motivo
    })).sort((a, b) => b.fecha.localeCompare(a.fecha)),
    eventos: eventos,
    tiposCompensacion: TIPOS_COMPENSACION,
    horario: String(config_().horario_laboral || '')
  };
}
