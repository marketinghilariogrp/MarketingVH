/**
 * Eventos y rotación del personal: quién cubre cada evento, con qué función, zona/etapa y horario.
 * El conteo mensual y el índice de equidad reemplazan al «Contador automático» del Excel.
 */

const ESTADOS_EVENTO = ['programado', 'realizado', 'cancelado']; // 'eliminado' se usa solo al borrar
const ESTADOS_COBERTURA = ['asignado', 'cubierto', 'ausente'];

/** Quiénes entran en la rotación: activos, no admin, salvo Config.excluidos_eventos (home office). */
function cubreEventos_(x) {
  return x.activo === 'SI' && x.rol !== 'admin' && !excluidoDe_(x, 'excluidos_eventos');
}

/** Elimina un evento creado por error (solo admin). Deja de verse en calendario, rotación e informes. */
function eliminarEvento(token, id) {
  const u = sesion_(token);
  exigirAdmin_(u);
  return conLock_(() => {
    const ev = leerTabla_('Eventos').find(x => x.id === id);
    if (!ev || ev.estado === 'eliminado') throw new Error('Evento no encontrado.');
    ev.estado = 'eliminado';
    ev.actualizada = ahora_();
    escribirFila_('Eventos', ev);
    log_(u.id, 'eliminar_evento', ev.id, ev.fecha + ' ' + ev.titulo);
    return true;
  });
}

function mesValido_(mes) {
  mes = texto_(mes, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error('Mes no válido.');
  return mes;
}

/** Eventos con su personal (sin coberturas retiradas). */
function eventosConPersonal_(filtro) {
  const nombres = mapaNombres_();
  const personal = {};
  leerTabla_('Cobertura').forEach(c => {
    if (c.estado === 'retirado') return;
    (personal[c.evento_id] = personal[c.evento_id] || []).push({
      id: c.id, usuario_id: c.usuario_id, nombre: nombres[c.usuario_id] || '—', funcion: c.rol_en_evento,
      zona: c.zona, horario: c.horario, estado: c.estado, nota: c.nota
    });
  });
  return leerTabla_('Eventos').filter(e => e.estado !== 'eliminado' && filtro(e)).map(e => ({
    id: e.id, fecha: e.fecha, titulo: e.titulo, empresa: e.empresa, lugar: e.lugar, detalle: e.detalle,
    hora_inicio: e.hora_inicio, hora_fin: e.hora_fin, estado: e.estado, personal: personal[e.id] || []
  })).sort((a, b) => (a.fecha + a.hora_inicio).localeCompare(b.fecha + b.hora_inicio));
}

/** Cuántos eventos cubrió cada persona en los eventos dados, con índice de equidad. */
function conteoEventos_(eventos) {
  const cuenta = {};
  eventos.filter(e => e.estado !== 'cancelado').forEach(e => {
    e.personal.filter(p => p.estado !== 'ausente').forEach(p => { cuenta[p.usuario_id] = (cuenta[p.usuario_id] || 0) + 1; });
  });
  const personas = usuarios_().filter(x => cuenta[x.id] || cubreEventos_(x));
  const total = personas.reduce((s, x) => s + (cuenta[x.id] || 0), 0);
  const promedio = personas.length ? total / personas.length : 0;
  return personas.map(x => {
    const n = cuenta[x.id] || 0;
    return { usuario_id: x.id, nombre: x.nombre, area: x.area, eventos: n,
      indice: promedio ? Math.round(n / promedio * 100) / 100 : null };
  }).sort((a, b) => b.eventos - a.eventos || a.nombre.localeCompare(b.nombre));
}

function listarEventos(token, mes) {
  sesion_(token);
  mes = mesValido_(mes);
  const anio = mes.slice(0, 4);
  const delAnio = eventosConPersonal_(e => e.fecha.slice(0, 4) === anio);
  const delMes = delAnio.filter(e => e.fecha.slice(0, 7) === mes);

  // Historial del año: eventos cubiertos por persona en cada mes, con el detalle de qué evento y marca.
  const historial = {};
  delAnio.filter(e => e.estado !== 'cancelado').forEach(e => e.personal.filter(p => p.estado !== 'ausente').forEach(p => {
    const h = historial[p.usuario_id] = historial[p.usuario_id] || { usuario_id: p.usuario_id, nombre: p.nombre, meses: Array(12).fill(0), eventos: [] };
    h.meses[Number(e.fecha.slice(5, 7)) - 1]++;
    h.eventos.push({ fecha: e.fecha, titulo: e.titulo, empresa: e.empresa, funcion: p.funcion });
  }));
  usuarios_().filter(x => cubreEventos_(x) && !historial[x.id]).forEach(x => {
    historial[x.id] = { usuario_id: x.id, nombre: x.nombre, meses: Array(12).fill(0), eventos: [] };
  });

  return {
    mes: mes, eventos: delMes, conteoMes: conteoEventos_(delMes), conteoAnio: conteoEventos_(delAnio),
    historial: Object.keys(historial).map(k => historial[k]).sort((a, b) => a.nombre.localeCompare(b.nombre))
  };
}

/** Crea o edita un evento y reemplaza su lista de personal. */
function guardarEvento(token, d) {
  const u = sesion_(token);
  exigirGestor_(u);
  d = d || {};
  const datos = {
    fecha: texto_(d.fecha, 10),
    titulo: texto_(d.titulo, 200),
    empresa: opcion_(d.empresa, lista_('marcas'), 'Elige la empresa o marca.'),
    lugar: texto_(d.lugar, 200),
    detalle: texto_(d.detalle, 2000),
    hora_inicio: texto_(d.hora_inicio, 5),
    hora_fin: texto_(d.hora_fin, 5),
    estado: opcion_(d.estado || 'programado', ESTADOS_EVENTO, 'Estado no válido.')
  };
  if (!esFecha_(datos.fecha)) throw new Error('Elige la fecha del evento.');
  if (!datos.titulo) throw new Error('Escribe el nombre del evento.');
  if ((datos.hora_inicio && !esHora_(datos.hora_inicio)) || (datos.hora_fin && !esHora_(datos.hora_fin))) {
    throw new Error('Hora no válida.');
  }

  const funciones = lista_('funciones_evento');
  const activos = usuarios_().filter(x => x.activo === 'SI' && !excluidoDe_(x, 'excluidos_eventos')).map(x => x.id);
  const personal = (Array.isArray(d.personal) ? d.personal : []).map(p => ({
    usuario_id: texto_(p.usuario_id, 40),
    funcion: opcion_(p.funcion, funciones, 'Elige la función de cada persona.'),
    zona: texto_(p.zona, 120),
    horario: texto_(p.horario, 60),
    estado: p.estado && ESTADOS_COBERTURA.indexOf(p.estado) >= 0 ? p.estado : ''
  }));
  const vistos = {};
  personal.forEach(p => {
    if (activos.indexOf(p.usuario_id) < 0) throw new Error('Hay una persona no válida en el personal.');
    if (vistos[p.usuario_id]) throw new Error('Una persona está repetida en el personal del evento.');
    vistos[p.usuario_id] = true;
  });

  return conLock_(() => {
    const ahora = ahora_();
    let ev;
    if (d.id) {
      ev = leerTabla_('Eventos').find(x => x.id === d.id);
      if (!ev) throw new Error('Evento no encontrado.');
      Object.assign(ev, datos, { actualizada: ahora });
      escribirFila_('Eventos', ev);
    } else {
      ev = Object.assign({ id: uuid_(), calendar_id: '', creado_por: u.id, actualizada: ahora }, datos);
      agregarFila_('Eventos', ev);
    }

    // Sincronizar personal: actualizar los que siguen, retirar los que salen, agregar los nuevos.
    const estadoBase = datos.estado === 'realizado' ? 'cubierto' : 'asignado';
    const actuales = leerTabla_('Cobertura').filter(c => c.evento_id === ev.id && c.estado !== 'retirado');
    const nuevos = [];
    personal.forEach(p => {
      const c = actuales.find(x => x.usuario_id === p.usuario_id);
      const estado = p.estado === 'ausente' ? 'ausente' : estadoBase;
      if (c) {
        Object.assign(c, { rol_en_evento: p.funcion, zona: p.zona, horario: p.horario, estado: estado });
        escribirFila_('Cobertura', c);
      } else {
        nuevos.push({ id: uuid_(), evento_id: ev.id, usuario_id: p.usuario_id, rol_en_evento: p.funcion,
          estado: estado, zona: p.zona, horario: p.horario, nota: '' });
      }
    });
    actuales.filter(c => !vistos[c.usuario_id]).forEach(c => {
      c.estado = 'retirado';
      escribirFila_('Cobertura', c);
    });
    agregarFilas_('Cobertura', nuevos);
    log_(u.id, d.id ? 'editar_evento' : 'crear_evento', ev.id, ev.fecha + ' ' + ev.titulo + ' · ' + personal.length + ' personas');

    // Avisar (sin bloquear) si alguien ya está en otro evento ese mismo día.
    const nombres = mapaNombres_();
    const mismoDia = eventosConPersonal_(e => e.fecha === ev.fecha && e.id !== ev.id && e.estado !== 'cancelado');
    const avisos = [];
    mismoDia.forEach(e => e.personal.forEach(p => {
      if (vistos[p.usuario_id]) avisos.push((nombres[p.usuario_id] || '—') + ' también está en «' + e.titulo + '»');
    }));
    return { id: ev.id, avisos: avisos };
  });
}
