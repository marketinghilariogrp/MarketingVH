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

/* ---------- Reporte de redes por rango de meses (coordinación/admin) ---------- */

function mesesEntre_(desde, hasta) {
  const out = [];
  let m = desde;
  while (m <= hasta && out.length < 36) {
    out.push(m);
    m = m.slice(5) === '12' ? (Number(m.slice(0, 4)) + 1) + '-01' : m.slice(0, 5) + String(Number(m.slice(5)) + 1).padStart(2, '0');
  }
  return out;
}

/**
 * Reporte completo de crecimiento entre dos meses: por cuenta, por marca, por red y mes a mes,
 * con lecturas automáticas. Base de comparación: el mes anterior a «desde» (si no hay, el primer mes con datos).
 */
function getReporteRedes(token, desdeMes, hastaMes, marca) {
  const u = sesion_(token);
  exigirGestor_(u);
  desdeMes = mesValido_(desdeMes);
  hastaMes = mesValido_(hastaMes);
  if (desdeMes > hastaMes) throw new Error('El mes inicial debe ser anterior al final.');
  return reporteRedes_(desdeMes, hastaMes, texto_(marca, 100));
}

function reporteRedes_(desdeMes, hastaMes, marca) {
  const meses = mesesEntre_(desdeMes, hastaMes);
  const base = mesAnterior_(desdeMes);
  const cuentas = leerTabla_('Redes_cuentas').filter(c => c.activo === 'SI' && (!marca || c.marca === marca));
  const datos = serieRedes_(base, hastaMes).filter(r => cuentas.some(c => c.id === r.cuenta_id));
  const de = (id, m) => datos.find(r => r.cuenta_id === id && r.mes === m) || null;
  const r1 = n => Math.round(n * 10) / 10;
  const pct = (a, b) => (b ? r1((a - b) / b * 100) : null);

  const resumir = (lista, etiqueta) => {
    const ini = lista.map(c => {
      const b = de(c.id, base);
      if (b && b.seguidores !== null) return b.seguidores;
      const p = meses.map(m => de(c.id, m)).find(x => x && x.seguidores !== null);
      return p ? p.seguidores : null;
    });
    const fin = lista.map(c => {
      const p = meses.slice().reverse().map(m => de(c.id, m)).find(x => x && x.seguidores !== null);
      return p ? p.seguidores : null;
    });
    const validos = lista.map((c, i) => ini[i] !== null && fin[i] !== null);
    const hay = validos.some(Boolean);
    const sIni = ini.reduce((s, v, i) => s + (validos[i] ? v : 0), 0);
    const sFin = fin.reduce((s, v, i) => s + (validos[i] ? v : 0), 0);
    const suma = k => lista.reduce((s, c) => s + meses.reduce((t, m) => t + ((de(c.id, m) || {})[k] || 0), 0), 0);
    const alcance = suma('alcance');
    const interacciones = suma('interacciones');
    const publicaciones = suma('publicaciones');
    return Object.assign(etiqueta, {
      seguidoresInicio: hay ? sIni : null,
      seguidoresFin: hay ? sFin : null,
      nuevos: hay ? sFin - sIni : null,
      crecimiento: hay ? pct(sFin, sIni) : null,
      alcance: alcance, visualizaciones: suma('visualizaciones'), interacciones: interacciones, publicaciones: publicaciones,
      engagement: alcance ? r1(interacciones / alcance * 100) : null,
      interaccionesPorPublicacion: publicaciones ? r1(interacciones / publicaciones) : null,
      mesesConDatos: meses.filter(m => lista.some(c => de(c.id, m))).length
    });
  };

  const porCuenta = cuentas.map(c => resumir([c], { cuenta_id: c.id, marca: c.marca, red: c.red, usuario: c.usuario }))
    .sort((a, b) => (a.marca + a.red).localeCompare(b.marca + b.red));
  const marcas = Array.from(new Set(cuentas.map(c => c.marca))).sort();
  const redes = Array.from(new Set(cuentas.map(c => c.red))).sort();
  const porMarca = marcas.map(m => resumir(cuentas.filter(c => c.marca === m), { marca: m }));
  const porRed = redes.map(r => resumir(cuentas.filter(c => c.red === r), { red: r }));
  const total = resumir(cuentas, { marca: 'Total' });

  // Mes a mes por marca (suma de las cuentas con dato ese mes).
  const mensual = marcas.map(m => ({
    marca: m,
    meses: meses.map(ms => {
      const rs = cuentas.filter(c => c.marca === m).map(c => de(c.id, ms)).filter(Boolean);
      const s = k => rs.reduce((t, r) => t + (r[k] || 0), 0);
      return { mes: ms, seguidores: rs.some(r => r.seguidores !== null) ? s('seguidores') : null, alcance: s('alcance'),
        visualizaciones: s('visualizaciones'), interacciones: s('interacciones'), publicaciones: s('publicaciones') };
    })
  }));
  const detalle = [];
  cuentas.forEach(c => meses.forEach(m => {
    const r = de(c.id, m);
    if (r) detalle.push({ marca: c.marca, red: c.red, usuario: c.usuario, mes: m, seguidores: r.seguidores, alcance: r.alcance,
      visualizaciones: r.visualizaciones, interacciones: r.interacciones, publicaciones: r.publicaciones });
  }));

  // Lecturas automáticas.
  const n = v => Number(v).toLocaleString('es-PE', { maximumFractionDigits: 1 });
  const signo = v => (v >= 0 ? '+' : '') + n(v) + '%';
  const lect = [];
  if (total.nuevos !== null) {
    lect.push({ tono: total.nuevos >= 0 ? 'bueno' : 'malo', texto: 'En el periodo las cuentas ' + (total.nuevos >= 0 ? 'sumaron ' : 'perdieron ') +
      n(Math.abs(total.nuevos)) + ' seguidores (' + signo(total.crecimiento) + '), de ' + n(total.seguidoresInicio) + ' a ' + n(total.seguidoresFin) + '.' });
  }
  const conCrec = porMarca.filter(x => x.crecimiento !== null);
  if (conCrec.length >= 2) {
    const o = conCrec.slice().sort((a, b) => b.crecimiento - a.crecimiento);
    lect.push({ tono: 'bueno', texto: 'La marca que más creció fue ' + o[0].marca + ' (' + signo(o[0].crecimiento) + ', ' + n(o[0].nuevos) + ' seguidores nuevos).' });
    const ult = o[o.length - 1];
    lect.push({ tono: ult.crecimiento < 0 ? 'malo' : 'neutro', texto: 'La de menor crecimiento fue ' + ult.marca + ' (' + signo(ult.crecimiento) + ').' });
  }
  const cuentasCrec = porCuenta.filter(x => x.crecimiento !== null);
  if (cuentasCrec.length) {
    const c = cuentasCrec.slice().sort((a, b) => b.crecimiento - a.crecimiento)[0];
    lect.push({ tono: 'bueno', texto: 'Cuenta destacada: ' + c.marca + ' en ' + c.red + ' con ' + signo(c.crecimiento) + ' de crecimiento.' });
    cuentasCrec.filter(x => x.nuevos < 0).forEach(x => lect.push({ tono: 'malo', texto: x.marca + ' en ' + x.red + ' perdió ' + n(Math.abs(x.nuevos)) + ' seguidores.' }));
  }
  const conEng = porMarca.filter(x => x.engagement !== null);
  if (conEng.length) {
    const e = conEng.slice().sort((a, b) => b.engagement - a.engagement)[0];
    lect.push({ tono: 'bueno', texto: 'Mejor tasa de interacción: ' + e.marca + ' con ' + n(e.engagement) + '% (interacciones ÷ alcance).' });
  }
  const conRed = porRed.filter(x => x.crecimiento !== null);
  if (conRed.length >= 2) {
    const r = conRed.slice().sort((a, b) => b.crecimiento - a.crecimiento)[0];
    lect.push({ tono: 'neutro', texto: 'Por red social, ' + r.red + ' fue la de mayor crecimiento (' + signo(r.crecimiento) + ').' });
  }
  const sinDatos = porCuenta.filter(x => x.mesesConDatos < meses.length).map(x => x.marca + ' ' + x.red);
  if (sinDatos.length) lect.push({ tono: 'neutro', texto: 'Faltan datos de algunos meses en: ' + sinDatos.join(', ') + '. Regístralos para un análisis completo.' });

  return { desde: desdeMes, hasta: hastaMes, base: base, marca: marca, meses: meses, total: total,
    porMarca: porMarca, porRed: porRed, porCuenta: porCuenta, mensual: mensual, detalle: detalle, lecturas: lect };
}

/** Exporta el reporte a un Google Sheet en la carpeta «MarketingVH · Reportes» y devuelve su enlace. */
function exportarReporteRedes(token, desdeMes, hastaMes, marca) {
  const rep = getReporteRedes(token, desdeMes, hastaMes, marca);
  const nombreMes = m => MESES_ES[Number(m.slice(5)) - 1].charAt(0) + MESES_ES[Number(m.slice(5)) - 1].slice(1).toLowerCase() + ' ' + m.slice(0, 4);
  const titulo = 'Reporte redes sociales · ' + nombreMes(rep.desde) + ' a ' + nombreMes(rep.hasta) + (rep.marca ? ' · ' + rep.marca : '');
  const ss = SpreadsheetApp.create(titulo);
  ss.setSpreadsheetLocale('es_PE');
  const carpetas = DriveApp.getFoldersByName('MarketingVH · Reportes');
  const carpeta = carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder('MarketingVH · Reportes');
  DriveApp.getFileById(ss.getId()).moveTo(carpeta);

  const v = x => (x === null || x === undefined ? '' : x);
  const escribir = (sh, cabecera, filas, tituloHoja) => {
    sh.getRange(1, 1).setValue(tituloHoja).setFontWeight('bold').setFontSize(13);
    sh.getRange(2, 1).setValue(titulo + ' · comparado con ' + nombreMes(rep.base)).setFontColor('#666666');
    sh.getRange(4, 1, 1, cabecera.length).setValues([cabecera]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    if (filas.length) sh.getRange(5, 1, filas.length, cabecera.length).setValues(filas);
    sh.setFrozenRows(4);
    sh.autoResizeColumns(1, cabecera.length);
  };
  const cab = ['Seguidores inicio', 'Seguidores fin', 'Nuevos', 'Crecimiento %', 'Alcance', 'Visualizaciones', 'Interacciones',
    'Publicaciones', 'Interacción % (inter./alcance)', 'Interacciones por publicación'];
  const vals = x => [v(x.seguidoresInicio), v(x.seguidoresFin), v(x.nuevos), v(x.crecimiento), x.alcance, x.visualizaciones,
    x.interacciones, x.publicaciones, v(x.engagement), v(x.interaccionesPorPublicacion)];

  const hResumen = ss.getSheets()[0].setName('Resumen');
  escribir(hResumen, ['Marca'].concat(cab), rep.porMarca.concat([rep.total]).map(x => [x.marca].concat(vals(x))), 'Resumen por marca');
  const fila = 6 + rep.porMarca.length + 2;
  hResumen.getRange(fila, 1).setValue('Lecturas').setFontWeight('bold');
  rep.lecturas.forEach((l, i) => hResumen.getRange(fila + 1 + i, 1).setValue('• ' + l.texto));
  escribir(ss.insertSheet('Por cuenta'), ['Marca', 'Red', 'Cuenta'].concat(cab), rep.porCuenta.map(x => [x.marca, x.red, x.usuario].concat(vals(x))), 'Detalle por cuenta');
  escribir(ss.insertSheet('Por red'), ['Red'].concat(cab), rep.porRed.map(x => [x.red].concat(vals(x))), 'Resumen por red social');
  escribir(ss.insertSheet('Mes a mes'), ['Marca', 'Red', 'Cuenta', 'Mes', 'Seguidores', 'Alcance', 'Visualizaciones', 'Interacciones', 'Publicaciones'],
    rep.detalle.map(x => [x.marca, x.red, x.usuario, nombreMes(x.mes), v(x.seguidores), v(x.alcance), v(x.visualizaciones), v(x.interacciones), v(x.publicaciones)]),
    'Evolución mensual por cuenta');
  return { url: ss.getUrl(), titulo: titulo };
}
