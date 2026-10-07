/**
 * Pauta: se leen los Google Sheets de pauta que el equipo ya actualiza (Fuentes_pauta) y se consolidan
 * en Pauta_diaria. Las columnas se reconocen por su encabezado (español o inglés, como las exporta Meta).
 * Sincronización automática cada hora (trigger sincronizarFuentes) o con el botón «Sincronizar».
 */

// Sinónimos de encabezado por campo, en orden de preferencia. Se compara con el encabezado normalizado.
const COLUMNAS_PAUTA = {
  fecha: ['inicio del informe', 'fecha de inicio', 'fecha', 'dia', 'day', 'date', 'reporting starts', 'semana', 'mes', 'periodo'],
  fecha_fin: ['fin del informe', 'fecha de fin', 'fecha fin', 'reporting ends', 'hasta'],
  campana: ['nombre de la campana', 'campana', 'campaign name', 'campaign', 'nombre del conjunto de anuncios', 'nombre del anuncio'],
  marca: ['marca', 'empresa', 'nombre de la cuenta', 'cuenta', 'account name'],
  inversion: ['importe gastado', 'inversion', 'monto invertido', 'gasto', 'amount spent', 'spend', 'costo total'],
  alcance: ['alcance', 'reach'],
  impresiones: ['impresiones', 'impressions'],
  clics: ['clics en el enlace', 'link clicks', 'clics', 'clicks'],
  resultados: ['resultados', 'results'],
  tipo_resultado: ['indicador de resultado', 'tipo de resultado', 'result indicator', 'result type'],
  leads: ['leads', 'clientes potenciales'],
  mensajes: ['conversaciones con mensajes iniciadas', 'conversaciones iniciadas', 'mensajes', 'conversaciones', 'messaging conversations started']
};
const MARCA_DESDE_COLUMNA = '(Columna Marca)';

/* ---------- Fuentes ---------- */

function listarFuentes(token) {
  const u = sesion_(token);
  exigirGestor_(u);
  return leerTabla_('Fuentes_pauta').filter(f => f.activo === 'SI').map(f => ({
    id: f.id, marca: f.marca, nombre: f.nombre, url: f.url, hoja: f.hoja,
    ultima_sync: f.ultima_sync, estado_sync: f.estado_sync, filas: Number(f.filas) || 0
  }));
}

function guardarFuente(token, d) {
  const u = sesion_(token);
  exigirGestor_(u);
  d = d || {};
  const datos = {
    marca: d.marca === MARCA_DESDE_COLUMNA ? MARCA_DESDE_COLUMNA : opcion_(d.marca, lista_('marcas'), 'Elige la marca.'),
    nombre: texto_(d.nombre, 120),
    url: texto_(d.url, 500),
    hoja: texto_(d.hoja, 200)
  };
  if (!datos.nombre) throw new Error('Escribe un nombre para la fuente.');
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+/.test(datos.url)) {
    throw new Error('Pega el enlace de un Google Sheet (https://docs.google.com/spreadsheets/d/…).');
  }
  conLock_(() => {
    if (d.id) {
      const f = leerTabla_('Fuentes_pauta').find(x => x.id === d.id);
      if (!f) throw new Error('Fuente no encontrada.');
      Object.assign(f, datos, { activo: d.activo === false ? 'NO' : 'SI' });
      escribirFila_('Fuentes_pauta', f);
    } else {
      agregarFila_('Fuentes_pauta', Object.assign({ id: uuid_(), activo: 'SI', creado: ahora_(), ultima_sync: '', estado_sync: '', filas: '0' }, datos));
    }
    log_(u.id, 'guardar_fuente_pauta', d.id || '', datos.nombre);
  });
  return sincronizarPauta_();
}

/* ---------- Lectura de las hojas ---------- */

function fechaCelda_(v) {
  if (v instanceof Date && !isNaN(v)) return fmt_(v, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return m[1] + '-' + m[2] + '-01';
  return '';
}

/** Asigna cada campo a una columna según los encabezados. Devuelve { campo: índice }. */
function mapearColumnas_(cabecera) {
  const norm = cabecera.map(normal_);
  const usadas = {};
  const mapa = {};
  Object.keys(COLUMNAS_PAUTA).forEach(campo => {
    for (const sin of COLUMNAS_PAUTA[campo]) {
      const i = norm.findIndex((h, j) => !usadas[j] && h && (h === sin || h.indexOf(sin + ' ') === 0));
      if (i >= 0) { mapa[campo] = i; usadas[i] = true; return; }
    }
  });
  return mapa;
}

function marcaDesdeTexto_(texto, marcas) {
  const t = normal_(texto);
  return marcas.find(m => t.indexOf(normal_(m)) >= 0 || normal_(m).indexOf(t) >= 0) || texto;
}

function leerFuente_(fuente, marcas) {
  const ss = SpreadsheetApp.openByUrl(fuente.url);
  const hojas = fuente.hoja === '*' ? ss.getSheets()
    : fuente.hoja ? fuente.hoja.split(',').map(n => ss.getSheetByName(n.trim())).filter(Boolean)
      : [ss.getSheets()[0]];
  if (!hojas.length) throw new Error('No se encontró la pestaña «' + fuente.hoja + '».');
  const filas = [];
  hojas.forEach(sh => {
    const valores = sh.getDataRange().getValues();
    let fila = -1;
    let mapa = null;
    for (let i = 0; i < Math.min(20, valores.length); i++) {
      const m = mapearColumnas_(valores[i]);
      if (m.fecha !== undefined && m.inversion !== undefined) { fila = i; mapa = m; break; }
    }
    if (!mapa) throw new Error('En «' + sh.getName() + '» no encontré columnas de fecha e inversión.');
    const val = (r, k) => (mapa[k] === undefined ? '' : r[mapa[k]]);
    valores.slice(fila + 1).forEach(r => {
      const fecha = fechaCelda_(val(r, 'fecha'));
      if (!fecha) return;
      const marca = fuente.marca === MARCA_DESDE_COLUMNA ? marcaDesdeTexto_(val(r, 'marca'), marcas) : fuente.marca;
      const campana = String(val(r, 'campana')).trim();
      if (normal_(campana).indexOf('total') === 0) return;
      filas.push({
        fuente_id: fuente.id, marca: marca, fecha: fecha, fecha_fin: fechaCelda_(val(r, 'fecha_fin')) || fecha,
        campana: campana || '(sin nombre)', inversion: num_(val(r, 'inversion')), alcance: num_(val(r, 'alcance')),
        impresiones: num_(val(r, 'impresiones')), clics: num_(val(r, 'clics')), resultados: num_(val(r, 'resultados')),
        tipo_resultado: String(val(r, 'tipo_resultado')).trim(), leads: num_(val(r, 'leads')), mensajes: num_(val(r, 'mensajes'))
      });
    });
  });
  return filas;
}

/** Relee todas las fuentes y reconstruye Pauta_diaria. */
function sincronizarPauta_() {
  const marcas = lista_('marcas');
  const fuentes = leerTabla_('Fuentes_pauta').filter(f => f.activo === 'SI');
  const todas = [];
  const estados = {};
  fuentes.forEach(f => {
    try {
      const filas = leerFuente_(f, marcas);
      filas.forEach(x => todas.push(x));
      estados[f.id] = { estado: 'OK', filas: filas.length };
    } catch (e) {
      // Si una fuente falla se conservan sus datos anteriores.
      leerTabla_('Pauta_diaria').filter(x => x.fuente_id === f.id).forEach(x => todas.push(x));
      estados[f.id] = { estado: 'Error: ' + e.message, filas: null };
    }
  });
  conLock_(() => {
    reescribirTabla_('Pauta_diaria', todas);
    leerTabla_('Fuentes_pauta').forEach(f => {
      if (!estados[f.id]) return;
      f.ultima_sync = ahora_();
      f.estado_sync = estados[f.id].estado;
      if (estados[f.id].filas !== null) f.filas = String(estados[f.id].filas);
      escribirFila_('Fuentes_pauta', f);
    });
  });
  return fuentes.map(f => ({ nombre: f.nombre, estado: estados[f.id].estado, filas: estados[f.id].filas }));
}

function sincronizarAhora(token) {
  const u = sesion_(token);
  exigirGestor_(u);
  return { pauta: sincronizarPauta_(), parrillas: sincronizarParrillas_() };
}

/** Trigger cada hora: pauta + parrillas. */
function sincronizarFuentes() {
  sincronizarPauta_();
  sincronizarParrillas_();
}

/** Variaciones fuertes de los últimos 7 días vs. los 7 anteriores, por marca (para las alertas). */
function alertasPauta_() {
  const umbral = Number(config_().umbral_variacion) || 30;
  const mon = (config_().moneda || 'S/') + ' ';
  const hoy = hoy_();
  const a1 = sumarDias_(hoy, -6);
  const b0 = sumarDias_(hoy, -13);
  const b1 = sumarDias_(hoy, -7);
  const filas = leerTabla_('Pauta_diaria').filter(r => r.fecha >= b0 && r.fecha <= hoy);
  const out = [];
  Array.from(new Set(filas.map(r => r.marca))).forEach(m => {
    const a = totales_(filas.filter(r => r.marca === m && r.fecha >= a1));
    const b = totales_(filas.filter(r => r.marca === m && r.fecha >= b0 && r.fecha <= b1));
    if (a.inversion > 0 && !a.resultados) out.push(m + ': ' + mon + a.inversion + ' invertidos en 7 días sin resultados registrados');
    const vi = variacion_(a.inversion, b.inversion);
    if (vi !== null && Math.abs(vi) >= umbral) out.push(m + ': la inversión ' + (vi > 0 ? 'subió ' : 'bajó ') + Math.abs(vi) + '% vs. la semana anterior');
    const vc = variacion_(a.cpr, b.cpr);
    if (vc !== null && vc >= umbral) out.push(m + ': el costo por resultado subió ' + vc + '% vs. la semana anterior');
  });
  return out;
}

/* ---------- Informe ejecutivo ---------- */

function totales_(filas) {
  const t = { inversion: 0, alcance: 0, impresiones: 0, clics: 0, resultados: 0, leads: 0, mensajes: 0 };
  filas.forEach(r => {
    ['inversion', 'alcance', 'impresiones', 'clics', 'leads', 'mensajes'].forEach(k => { t[k] += Number(r[k]) || 0; });
    const res = Number(r.resultados) || 0;
    t.resultados += res > 0 ? res : (Number(r.leads) || 0) + (Number(r.mensajes) || 0);
  });
  const r2 = n => Math.round(n * 100) / 100;
  t.inversion = r2(t.inversion);
  t.cpr = t.resultados ? r2(t.inversion / t.resultados) : null;
  t.ctr = t.impresiones ? r2(t.clics / t.impresiones * 100) : null;
  t.cpm = t.impresiones ? r2(t.inversion / t.impresiones * 1000) : null;
  t.cpc = t.clics ? r2(t.inversion / t.clics) : null;
  return t;
}

const variacion_ = (a, b) => (b ? Math.round((a - b) / b * 1000) / 10 : null);

function clavePeriodo_(fecha, gran) {
  if (gran === 'mes') return fecha.slice(0, 7);
  if (gran === 'semana') return sumarDias_(fecha, 1 - diaSemana_(fecha));
  return fecha;
}

/**
 * Informe del periodo [desde, hasta] comparado con [antDesde, antHasta]
 * (si no se indica, los mismos días inmediatamente anteriores).
 */
function getInforme(token, desde, hasta, marca, antDesde, antHasta) {
  const u = sesion_(token);
  exigirGestor_(u);
  desde = texto_(desde, 10);
  hasta = texto_(hasta, 10);
  marca = texto_(marca, 100);
  if (!esFecha_(desde) || !esFecha_(hasta) || desde > hasta) throw new Error('Rango de fechas no válido.');
  if (desde > hoy_()) throw new Error('El periodo todavía no empieza.');

  // La agrupación de los gráficos depende del periodo elegido completo.
  const diasPeriodo = Math.round((new Date(hasta + 'T12:00:00') - new Date(desde + 'T12:00:00')) / 864e5) + 1;
  const gran = diasPeriodo <= 31 ? 'dia' : diasPeriodo <= 124 ? 'semana' : 'mes';
  // Periodo en curso: se corta en hoy y se compara con los mismos días del periodo anterior.
  if (hasta > hoy_()) hasta = hoy_();
  const dias = Math.round((new Date(hasta + 'T12:00:00') - new Date(desde + 'T12:00:00')) / 864e5) + 1;
  if (!esFecha_(antDesde) || !esFecha_(antHasta) || antDesde > antHasta) {
    antHasta = sumarDias_(desde, -1);
    antDesde = sumarDias_(desde, -dias);
  } else if (sumarDias_(antDesde, dias - 1) < antHasta) {
    antHasta = sumarDias_(antDesde, dias - 1);
  }
  const deMarca = r => !marca || r.marca === marca;
  const pauta = leerTabla_('Pauta_diaria').filter(deMarca);
  const enRango = (r, a, b) => r.fecha >= a && r.fecha <= b;
  const actual = pauta.filter(r => enRango(r, desde, hasta));
  const anterior = pauta.filter(r => enRango(r, antDesde, antHasta));
  const tA = totales_(actual);
  const tB = totales_(anterior);

  // Serie del periodo (rellena los huecos).
  const serie = [];
  const grupos = {};
  actual.forEach(r => { (grupos[clavePeriodo_(r.fecha, gran)] = grupos[clavePeriodo_(r.fecha, gran)] || []).push(r); });
  for (let f = desde; f <= hasta; f = sumarDias_(f, 1)) {
    const k = clavePeriodo_(f, gran);
    if (!serie.length || serie[serie.length - 1].k !== k) serie.push({ k: k, t: totales_(grupos[k] || []) });
  }

  // Histórico: 12 meses hasta el mes de «hasta».
  const historico = [];
  let mes = hasta.slice(0, 7);
  for (let i = 0; i < 12; i++) { historico.unshift(mes); mes = mesAnterior_(mes); }
  const porMes = {};
  pauta.forEach(r => { (porMes[r.fecha.slice(0, 7)] = porMes[r.fecha.slice(0, 7)] || []).push(r); });
  const hist = historico.map(m => ({ k: m, t: totales_(porMes[m] || []) }));
  const previos = hist.filter(h => h.k < desde.slice(0, 7) && h.t.resultados > 0).slice(-6);
  const cprHistorico = previos.length ? Math.round(previos.reduce((s, h) => s + h.t.inversion, 0) / previos.reduce((s, h) => s + h.t.resultados, 0) * 100) / 100 : null;

  const marcas = lista_('marcas');
  const porMarca = marcas.concat(Object.keys(actual.reduce((o, r) => { if (marcas.indexOf(r.marca) < 0) o[r.marca] = 1; return o; }, {})))
    .filter(m => !marca || m === marca)
    .map(m => ({ marca: m, actual: totales_(actual.filter(r => r.marca === m)), anterior: totales_(anterior.filter(r => r.marca === m)) }))
    .filter(x => x.actual.inversion || x.anterior.inversion);

  const camp = {};
  actual.forEach(r => { const k = r.marca + '|' + r.campana; (camp[k] = camp[k] || []).push(r); });
  const campanas = Object.keys(camp).map(k => Object.assign({ marca: k.split('|')[0], campana: k.split('|').slice(1).join('|') }, totales_(camp[k])))
    .sort((a, b) => b.inversion - a.inversion);

  const redes = informeRedes_(desde, hasta, marca);
  const contenido = informeContenido_(desde, hasta, marca);
  const operacion = informeOperacion_(desde, hasta, marca);

  const informe = {
    desde: desde, hasta: hasta, marca: marca, dias: dias, granularidad: gran,
    anterior: { desde: antDesde, hasta: antHasta },
    totales: tA, totalesAnterior: tB,
    variaciones: {
      inversion: variacion_(tA.inversion, tB.inversion), resultados: variacion_(tA.resultados, tB.resultados),
      cpr: variacion_(tA.cpr, tB.cpr), ctr: variacion_(tA.ctr, tB.ctr), alcance: variacion_(tA.alcance, tB.alcance),
      impresiones: variacion_(tA.impresiones, tB.impresiones), cpm: variacion_(tA.cpm, tB.cpm)
    },
    cprHistorico: cprHistorico,
    serie: serie, historico: hist, porMarca: porMarca, campanas: campanas.slice(0, 15),
    redes: redes, contenido: contenido, operacion: operacion,
    hayPauta: pauta.length > 0
  };
  informe.interpretaciones = interpretar_(informe, campanas);
  return informe;
}

function informeRedes_(desde, hasta, marca) {
  const mDesde = desde.slice(0, 7);
  const mHasta = hasta.slice(0, 7);
  const base = mesAnterior_(mDesde);
  const datos = serieRedes_(base, mHasta).filter(r => !marca || r.marca === marca);
  const ultimoMes = id => datos.filter(r => r.cuenta_id === id && r.mes >= mDesde && r.seguidores !== null).sort((a, b) => b.mes.localeCompare(a.mes))[0];
  const cuentas = {};
  datos.forEach(r => { cuentas[r.cuenta_id] = r; });
  const filas = Object.keys(cuentas).map(id => {
    const c = cuentas[id];
    const fin = ultimoMes(id);
    const ini = datos.find(r => r.cuenta_id === id && r.mes === base);
    const enPeriodo = datos.filter(r => r.cuenta_id === id && r.mes >= mDesde && r.mes <= mHasta);
    const suma = k => enPeriodo.reduce((s, r) => s + (r[k] || 0), 0);
    const seguidores = fin ? fin.seguidores : null;
    const inicial = ini ? ini.seguidores : null;
    return {
      marca: c.marca, red: c.red, seguidores: seguidores, nuevos: seguidores !== null && inicial !== null ? seguidores - inicial : null,
      crecimiento: seguidores !== null && inicial ? Math.round((seguidores - inicial) / inicial * 1000) / 10 : null,
      alcance: suma('alcance'), visualizaciones: suma('visualizaciones'), interacciones: suma('interacciones'), publicaciones: suma('publicaciones')
    };
  }).sort((a, b) => (a.marca + a.red).localeCompare(b.marca + b.red));
  // Seguidores por marca, mes a mes (12 meses hasta «hasta»).
  const meses = [];
  let m = mHasta;
  for (let i = 0; i < 12; i++) { meses.unshift(m); m = mesAnterior_(m); }
  const todas = serieRedes_(meses[0], mHasta).filter(r => !marca || r.marca === marca);
  const marcas = Array.from(new Set(todas.map(r => r.marca))).sort();
  return {
    cuentas: filas,
    meses: meses,
    seguidoresPorMarca: marcas.map(mc => ({ marca: mc, valores: meses.map(ms => {
      const rs = todas.filter(r => r.marca === mc && r.mes === ms && r.seguidores !== null);
      return rs.length ? rs.reduce((s, r) => s + r.seguidores, 0) : null;
    }) }))
  };
}

function informeContenido_(desde, hasta, marca) {
  const hoy = hoy_();
  const pubs = leerTabla_('Agenda').filter(a => a.tipo === 'Publicación' && a.fecha >= desde && a.fecha <= hasta &&
    a.estado !== 'cancelado' && (!marca || a.marca === marca));
  const cuenta = (lista, k) => {
    const o = {};
    lista.forEach(a => { const v = a[k] || 'Sin dato'; o[v] = (o[v] || 0) + 1; });
    return Object.keys(o).map(x => ({ k: x, v: o[x] })).sort((a, b) => b.v - a.v);
  };
  const porMarca = Array.from(new Set(pubs.map(a => a.marca))).sort().map(m => {
    const l = pubs.filter(a => a.marca === m);
    return { marca: m, planificadas: l.length, publicadas: l.filter(a => a.estado === 'hecho').length,
      atrasadas: l.filter(a => a.estado === 'pendiente' && a.fecha < hoy).length };
  });
  const publicadas = pubs.filter(a => a.estado === 'hecho').length;
  const vencidas = pubs.filter(a => a.fecha < hoy);
  return {
    planificadas: pubs.length, publicadas: publicadas,
    atrasadas: pubs.filter(a => a.estado === 'pendiente' && a.fecha < hoy).length,
    cumplimiento: vencidas.length ? Math.round(vencidas.filter(a => a.estado === 'hecho').length / vencidas.length * 100) : null,
    porMarca: porMarca, porFormato: cuenta(pubs, 'formato'), porPilar: cuenta(pubs, 'pilar'), porRed: cuenta(pubs, 'red')
  };
}

function informeOperacion_(desde, hasta, marca) {
  const deMarca = (m) => !marca || m === marca;
  const tareas = leerTabla_('Tareas').filter(t => t.estado === 'aprobada' && t.completada.slice(0, 10) >= desde &&
    t.completada.slice(0, 10) <= hasta && deMarca(t.marca));
  const aTiempo = tareas.filter(t => t.completada.slice(0, 10) <= t.vence).length;
  const eventos = eventosConPersonal_(e => e.fecha >= desde && e.fecha <= hasta && e.estado !== 'cancelado' && deMarca(e.empresa));
  const horas = leerTabla_('Horas').filter(h => h.estado === 'activo' && h.fecha >= desde && h.fecha <= hasta && (!marca || h.marca === marca));
  const extra = leerTabla_('Sobretiempo').filter(s => s.estado === 'aprobado' && s.fecha >= desde && s.fecha <= hasta);
  const porTipo = {};
  tareas.forEach(t => { porTipo[t.tipo || 'Sin tipo'] = (porTipo[t.tipo || 'Sin tipo'] || 0) + 1; });
  return {
    tareasAprobadas: tareas.length,
    aTiempo: tareas.length ? Math.round(aTiempo / tareas.length * 100) : null,
    tareasPorTipo: Object.keys(porTipo).map(k => ({ k: k, v: porTipo[k] })).sort((a, b) => b.v - a.v),
    eventos: eventos.length,
    coberturas: eventos.reduce((s, e) => s + e.personal.filter(p => p.estado !== 'ausente').length, 0),
    horas: Math.round(horas.reduce((s, h) => s + (Number(h.horas) || 0), 0) * 10) / 10,
    horasExtra: marca ? null : Math.round(extra.reduce((s, x) => s + (Number(x.horas) || 0), 0) * 10) / 10
  };
}

/** Lecturas automáticas en lenguaje simple para el informe. */
function interpretar_(inf, campanas) {
  const mon = (config_().moneda || 'S/') + ' ';
  const n = v => Number(v).toLocaleString('es-PE', { maximumFractionDigits: 2 });
  const pct = v => (v > 0 ? '+' : '') + n(v) + '%';
  const t = inf.totales;
  const v = inf.variaciones;
  const out = [];

  if (!inf.hayPauta) {
    out.push({ tono: 'neutro', texto: 'Aún no hay datos de pauta. Vincula tus Google Sheets de pauta en «Fuentes de datos».' });
  } else if (!t.inversion) {
    out.push({ tono: 'neutro', texto: 'No hubo inversión en pauta en este periodo.' });
  } else {
    out.push({ tono: 'neutro', texto: 'Se invirtieron ' + mon + n(t.inversion) +
      (v.inversion !== null ? ' (' + pct(v.inversion) + ' vs. el periodo anterior)' : '') + ' y se obtuvieron ' + n(t.resultados) + ' resultados.' });
    if (t.cpr !== null) {
      let txt = 'Cada resultado costó en promedio ' + mon + n(t.cpr);
      let tono = 'neutro';
      if (v.cpr !== null) {
        txt += v.cpr < 0 ? ', ' + n(Math.abs(v.cpr)) + '% más barato que el periodo anterior' : v.cpr > 0 ? ', ' + n(v.cpr) + '% más caro que el periodo anterior' : ', igual que el periodo anterior';
        tono = v.cpr <= -5 ? 'bueno' : v.cpr >= 5 ? 'malo' : 'neutro';
      }
      if (inf.cprHistorico) {
        const d = Math.round((t.cpr - inf.cprHistorico) / inf.cprHistorico * 100);
        txt += '. Frente al promedio de los últimos meses (' + mon + n(inf.cprHistorico) + ') está ' + (d <= 0 ? n(Math.abs(d)) + '% por debajo' : n(d) + '% por encima');
      }
      out.push({ tono: tono, texto: txt + '.' });
    }
    if (v.ctr !== null && Math.abs(v.ctr) >= 10) {
      out.push({ tono: v.ctr > 0 ? 'bueno' : 'malo', texto: 'La tasa de clics (CTR) ' + (v.ctr > 0 ? 'mejoró ' : 'bajó ') + n(Math.abs(v.ctr)) + '%: los anuncios ' + (v.ctr > 0 ? 'están captando más' : 'están captando menos') + ' la atención.' });
    }
    const conRes = inf.porMarca.filter(m => m.actual.cpr !== null && m.actual.inversion >= t.inversion * 0.05);
    if (conRes.length >= 2) {
      const orden = conRes.slice().sort((a, b) => a.actual.cpr - b.actual.cpr);
      out.push({ tono: 'bueno', texto: orden[0].marca + ' es la marca más eficiente: ' + mon + n(orden[0].actual.cpr) + ' por resultado.' });
      out.push({ tono: 'malo', texto: orden[orden.length - 1].marca + ' tiene el costo por resultado más alto: ' + mon + n(orden[orden.length - 1].actual.cpr) + '.' });
    }
    const sinRes = campanas.filter(c => c.inversion >= Math.max(50, t.inversion * 0.05) && !c.resultados);
    if (sinRes.length) {
      out.push({ tono: 'malo', texto: 'Revisar: ' + sinRes.slice(0, 3).map(c => '«' + c.campana + '» (' + c.marca + ', ' + mon + n(c.inversion) + ')').join(', ') + ' invirtieron sin resultados registrados.' });
    }
    const top = campanas.filter(c => c.cpr !== null && c.inversion >= t.inversion * 0.05).sort((a, b) => a.cpr - b.cpr)[0];
    if (top) out.push({ tono: 'bueno', texto: 'Campaña destacada: «' + top.campana + '» (' + top.marca + ') con ' + n(top.resultados) + ' resultados a ' + mon + n(top.cpr) + ' cada uno.' });
  }

  const redes = inf.redes.cuentas.filter(c => c.crecimiento !== null);
  if (redes.length) {
    const mejor = redes.slice().sort((a, b) => b.crecimiento - a.crecimiento)[0];
    const nuevos = redes.reduce((s, c) => s + (c.nuevos || 0), 0);
    out.push({ tono: nuevos >= 0 ? 'bueno' : 'malo', texto: 'Redes: ' + (nuevos >= 0 ? 'se sumaron ' : 'se perdieron ') + n(Math.abs(nuevos)) + ' seguidores. El mayor crecimiento fue ' + mejor.marca + ' en ' + mejor.red + ' (' + pct(mejor.crecimiento) + ').' });
  }
  const c = inf.contenido;
  if (c.planificadas) {
    out.push({ tono: c.cumplimiento === null ? 'neutro' : c.cumplimiento >= 90 ? 'bueno' : c.cumplimiento < 75 ? 'malo' : 'neutro',
      texto: 'Contenido: ' + c.publicadas + ' de ' + c.planificadas + ' publicaciones planificadas ya salieron' +
        (c.cumplimiento !== null ? ' (cumplimiento ' + c.cumplimiento + '% de lo que ya debía publicarse)' : '') +
        (c.atrasadas ? '; ' + c.atrasadas + (c.atrasadas === 1 ? ' sigue pendiente' : ' siguen pendientes') + ' con fecha pasada.' : '.') });
  }
  const o = inf.operacion;
  if (o.tareasAprobadas) {
    out.push({ tono: o.aTiempo >= 85 ? 'bueno' : o.aTiempo < 70 ? 'malo' : 'neutro',
      texto: 'Producción: ' + o.tareasAprobadas + ' piezas aprobadas, ' + o.aTiempo + '% entregadas a tiempo. ' + o.eventos + ' eventos cubiertos.' });
  }
  return out;
}
