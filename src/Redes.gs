/**
 * Redes sociales: métricas mensuales por cuenta (seguidores, alcance, visualizaciones, interacciones,
 * publicaciones), registradas por la coordinación. Sirven para comparar crecimiento por marca y periodo.
 */

const METRICAS_REDES = ['seguidores', 'alcance', 'visualizaciones', 'interacciones', 'publicaciones'];

const CUENTAS_REDES_INICIALES = [
  ['EDE', 'Facebook', 'El despertar del Emprendedor', 'https://www.facebook.com/profile.php?id=61579828617275'],
  ['EDE', 'Instagram', '@ede.eldespertar', 'https://www.instagram.com/ede.eldespertar/'],
  ['EDE', 'TikTok', '@despertardelemprendedor', 'https://www.tiktok.com/@despertardelemprendedor'],
  ['Nexo', 'TikTok', '@nexo_business', 'https://www.tiktok.com/@nexo_business'],
  ['Nexo', 'Facebook', 'Nexo Business', 'https://www.facebook.com/profile.php?id=61571748286265'],
  ['Nexo', 'Instagram', '@nexobusiness.pe', 'https://www.instagram.com/nexobusiness.pe/'],
  ['Marca Personal', 'Facebook', 'Soy Vitmer Hilario', 'https://www.facebook.com/soyvitmerhilario'],
  ['Marca Personal', 'Instagram', '@vitmerhilario', 'https://www.instagram.com/vitmerhilario/'],
  ['Marca Personal', 'TikTok', '@vitmerhilario', 'https://www.tiktok.com/@vitmerhilario'],
  ['Vyc', 'Facebook', 'Vyc Grupo Inmobiliario', 'https://www.facebook.com/vycgrupoinmobiliario'],
  ['Vyc', 'Instagram', '@grupo.vyc', 'https://www.instagram.com/grupo.vyc'],
  ['Vyc', 'TikTok', '@grupo.vyc', 'https://www.tiktok.com/@grupo.vyc'],
  ['Academia VH Business', 'TikTok', '@academiavhbusiness', 'https://www.tiktok.com/@academiavhbusiness'],
  ['Academia VH Business', 'Instagram', '@academiavhbusiness', 'https://www.instagram.com/academiavhbusiness/'],
  ['Academia VH Business', 'Facebook', 'Academia VH Business', 'https://www.facebook.com/vitmerhilariom/']
];

/** Cuentas con las métricas del mes pedido y del mes anterior. */
function listarRedes(token, mes) {
  sesion_(token);
  mes = mesValido_(mes);
  const anterior = mesAnterior_(mes);
  const metricas = leerTabla_('Redes_metricas');
  const de = (id, m) => metricas.find(x => x.cuenta_id === id && x.mes === m) || null;
  const limpio = r => {
    if (!r) return null;
    const o = {};
    METRICAS_REDES.forEach(k => { o[k] = r[k] === '' ? null : Number(r[k]); });
    return o;
  };
  return {
    mes: mes,
    cuentas: leerTabla_('Redes_cuentas').filter(c => c.activo === 'SI').map(c => ({
      id: c.id, marca: c.marca, red: c.red, usuario: c.usuario, url: c.url,
      actual: limpio(de(c.id, mes)), anterior: limpio(de(c.id, anterior))
    })).sort((a, b) => (a.marca + a.red).localeCompare(b.marca + b.red))
  };
}

function mesAnterior_(mes) {
  const a = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return m === 1 ? (a - 1) + '-12' : a + '-' + String(m - 1).padStart(2, '0');
}

/** Guarda (crea o actualiza) las métricas del mes para varias cuentas. */
function guardarRedes(token, mes, filas) {
  const u = sesion_(token);
  exigirGestor_(u);
  mes = mesValido_(mes);
  const cuentas = leerTabla_('Redes_cuentas').map(c => c.id);
  filas = (Array.isArray(filas) ? filas : []).filter(f => cuentas.indexOf(f.cuenta_id) >= 0);
  return conLock_(() => {
    const existentes = leerTabla_('Redes_metricas');
    const nuevas = [];
    filas.forEach(f => {
      const datos = {};
      METRICAS_REDES.forEach(k => {
        const v = f[k];
        if (v === '' || v == null) { datos[k] = ''; return; }
        const n = Number(v);
        if (isNaN(n) || n < 0) throw new Error('Los valores deben ser números positivos.');
        datos[k] = String(Math.round(n));
      });
      if (METRICAS_REDES.every(k => datos[k] === '')) return;
      const r = existentes.find(x => x.cuenta_id === f.cuenta_id && x.mes === mes);
      if (r) { Object.assign(r, datos, { registrado_por: u.id, actualizado: ahora_() }); escribirFila_('Redes_metricas', r); }
      else nuevas.push(Object.assign({ id: uuid_(), cuenta_id: f.cuenta_id, mes: mes, registrado_por: u.id, actualizado: ahora_() }, datos));
    });
    agregarFilas_('Redes_metricas', nuevas);
    log_(u.id, 'guardar_redes', mes, filas.length + ' cuentas');
    return true;
  });
}

function guardarCuentaRed(token, d) {
  const u = sesion_(token);
  exigirGestor_(u);
  d = d || {};
  const datos = {
    marca: opcion_(d.marca, lista_('marcas'), 'Elige la marca.'),
    red: opcion_(d.red, ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'LinkedIn', 'X'], 'Elige la red.'),
    usuario: texto_(d.usuario, 120),
    url: texto_(d.url, 300)
  };
  if (!datos.usuario) throw new Error('Escribe el nombre o usuario de la cuenta.');
  return conLock_(() => {
    if (d.id) {
      const c = leerTabla_('Redes_cuentas').find(x => x.id === d.id);
      if (!c) throw new Error('Cuenta no encontrada.');
      Object.assign(c, datos, { activo: d.activo === false ? 'NO' : 'SI' });
      escribirFila_('Redes_cuentas', c);
    } else {
      agregarFila_('Redes_cuentas', Object.assign({ id: uuid_(), activo: 'SI' }, datos));
    }
    log_(u.id, 'guardar_cuenta_red', d.id || '', datos.marca + ' ' + datos.red);
    return true;
  });
}

/** Serie mensual por cuenta entre dos meses (para informes). */
function serieRedes_(desdeMes, hastaMes) {
  const cuentas = {};
  leerTabla_('Redes_cuentas').forEach(c => { cuentas[c.id] = c; });
  return leerTabla_('Redes_metricas')
    .filter(r => r.mes >= desdeMes && r.mes <= hastaMes && cuentas[r.cuenta_id])
    .map(r => {
      const o = { cuenta_id: r.cuenta_id, marca: cuentas[r.cuenta_id].marca, red: cuentas[r.cuenta_id].red, mes: r.mes };
      METRICAS_REDES.forEach(k => { o[k] = r[k] === '' ? null : Number(r[k]); });
      return o;
    });
}
