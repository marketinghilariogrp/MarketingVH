/**
 * Alquiler de equipos por evento (cámaras, lentes, memorias, transmisores, PTZ, baterías…).
 * Solo lo ven y editan el administrador y las personas de Config.gestion_alquiler (por defecto, Jefferson).
 */

const EQUIPOS_ALQUILER = ['Cámara', 'Lente', 'Memoria', 'Transmisor', 'PTZ', 'Batería', 'Trípode', 'Estabilizador',
  'Micrófono', 'Iluminación', 'Drone', 'Otro'];
const ESTADOS_ALQUILER = ['Por cotizar', 'Cotizado', 'Confirmado', 'Devuelto'];

function puedeAlquiler_(u) {
  if (u.rol === 'admin') return true;
  const nombres = config_().gestion_alquiler === undefined ? ['Jefferson'] : lista_('gestion_alquiler');
  const primero = s => normal_(s).split(' ')[0];
  return nombres.map(primero).indexOf(primero(u.nombre)) >= 0;
}

function equiposAlquiler_() {
  const l = lista_('equipos_alquiler');
  return l.length ? l : EQUIPOS_ALQUILER;
}

/** Agrega a cada evento su lista de equipos a alquilar (solo si la persona puede verlos). */
function adjuntarAlquiler_(eventos, u) {
  if (!puedeAlquiler_(u)) return eventos;
  const porEvento = {};
  leerTabla_('Alquileres').filter(a => a.estado !== 'eliminado').forEach(a => {
    (porEvento[a.evento_id] = porEvento[a.evento_id] || []).push({
      id: a.id, equipo: a.equipo, detalle: a.detalle, cantidad: Number(a.cantidad) || 1, proveedor: a.proveedor,
      costo: a.costo === '' ? null : Number(a.costo), estado: a.estado
    });
  });
  eventos.forEach(e => { e.alquiler = porEvento[e.id] || []; });
  return eventos;
}

/** Reemplaza la lista de equipos de un evento. Llamar dentro de conLock_. */
function guardarAlquilerInterno_(u, eventoId, filas) {
  const equipos = equiposAlquiler_();
  const limpias = (Array.isArray(filas) ? filas : []).map(f => {
    const cantidad = f.cantidad === '' || f.cantidad == null ? 1 : Math.round(Number(f.cantidad));
    const costo = f.costo === '' || f.costo == null ? '' : Number(f.costo);
    if (!(cantidad >= 1 && cantidad <= 99)) throw new Error('La cantidad de cada equipo debe estar entre 1 y 99.');
    if (costo !== '' && (isNaN(costo) || costo < 0)) throw new Error('El costo del alquiler debe ser un número.');
    return {
      id: texto_(f.id, 40),
      equipo: opcion_(f.equipo, equipos, 'Elige el tipo de equipo.'),
      detalle: texto_(f.detalle, 200),
      cantidad: String(cantidad),
      proveedor: texto_(f.proveedor, 120),
      costo: costo === '' ? '' : String(Math.round(costo * 100) / 100),
      estado: opcion_(f.estado || ESTADOS_ALQUILER[0], ESTADOS_ALQUILER, 'Estado de alquiler no válido.')
    };
  });
  const actuales = leerTabla_('Alquileres').filter(a => a.evento_id === eventoId && a.estado !== 'eliminado');
  const ahora = ahora_();
  const nuevas = [];
  limpias.forEach(f => {
    const a = f.id && actuales.find(x => x.id === f.id);
    if (a) {
      Object.assign(a, f, { actualizado: ahora });
      escribirFila_('Alquileres', a);
    } else {
      nuevas.push(Object.assign({}, f, { id: uuid_(), evento_id: eventoId, creado_por: u.id, actualizado: ahora }));
    }
  });
  actuales.filter(a => !limpias.some(f => f.id === a.id)).forEach(a => {
    a.estado = 'eliminado';
    a.actualizado = ahora;
    escribirFila_('Alquileres', a);
  });
  agregarFilas_('Alquileres', nuevas);
  if (limpias.length || actuales.length) log_(u.id, 'alquiler_equipos', eventoId, limpias.length + ' equipos');
}
