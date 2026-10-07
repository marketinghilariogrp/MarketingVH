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
    id: f.id, marca: f.marca, nombre: f.nombre, url: f.url, hoja: f.hoja, moneda: f.moneda,
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
    hoja: texto_(d.hoja, 200),
    moneda: d.moneda ? opcion_(d.moneda, MONEDAS, 'Moneda no válida.') : ''
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

/*
 * ---------- Monedas: cada cuenta publicitaria está en PEN o USD ----------
 * Los montos NO se convierten: cada cifra se muestra con el símbolo de su cuenta (S/ o $).
 * Si un total mezcla monedas, se informa por separado (S/ … + $ …).
 */

const MONEDAS = ['PEN', 'USD'];
const SIMBOLO = { PEN: 'S/', USD: '$' };

/** «S/ 240.00» o, si hay varias monedas, «S/ 240.00 + $ 120.00». */
function montoTexto_(t, campo) {
  campo = campo || 'inversion';
  const n = v => Number(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const partes = MONEDAS.filter(m => t.monedas[m] && t.monedas[m][campo] !== null)
    .map(m => SIMBOLO[m] + ' ' + n(t.monedas[m][campo]));
  return partes.join(' + ') || '—';
}

/** PEN o USD si el texto lo indica («13.32 PEN», «US$ 5», «Importe gastado (USD)», «Moneda PEN»…). */
function monedaEnTexto_(s) {
  const t = String(s == null ? '' : s).toUpperCase();
  if (/\bUSD\b|US\$|DÓLAR|DOLAR/.test(t)) return 'USD';
  if (/\bPEN\b|S\/|SOLES/.test(t)) return 'PEN';
  return '';
}

/** Moneda de una hoja: encabezado de inversión, filas de título o la pestaña «Info» (fila «Moneda»). */
function monedaDeHoja_(ss, valores, filaCab, colInversion) {
  const enCab = monedaEnTexto_(valores[filaCab][colInversion]);
  if (enCab) return enCab;
  for (let i = 0; i < filaCab; i++) {
    const m = valores[i].map(monedaEnTexto_).find(String);
    if (m) return m;
  }
  const info = ss.getSheetByName('Info');
  if (info) {
    const fila = info.getDataRange().getValues().find(r => normal_(r[0]) === 'moneda');
    if (fila) return monedaEnTexto_(fila[1]);
  }
  return '';
}

function leerFuente_(fuente, marcas) {
  const ss = SpreadsheetApp.openByUrl(fuente.url);
  // Sin pestaña indicada se usa «Diario» (una fila por campaña y día) si existe; si no, la primera.
  const hojas = fuente.hoja === '*' ? ss.getSheets()
    : fuente.hoja ? fuente.hoja.split(',').map(n => ss.getSheetByName(n.trim())).filter(Boolean)
      : [ss.getSheetByName('Diario') || ss.getSheets()[0]];
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
    // Moneda: la elegida en la fuente; si no, la que diga la hoja; si no, PEN para las marcas de Config.marcas_en_soles y USD para las demás.
    const monedaHoja = fuente.moneda || monedaDeHoja_(ss, valores, fila, mapa.inversion);
    valores.slice(fila + 1).forEach(r => {
      const fecha = fechaCelda_(val(r, 'fecha'));
      if (!fecha) return;
      const marca = fuente.marca === MARCA_DESDE_COLUMNA ? marcaDesdeTexto_(val(r, 'marca'), marcas) : fuente.marca;
      const campana = String(val(r, 'campana')).trim();
      if (normal_(campana).indexOf('total') === 0) return;
      const moneda = fuente.moneda || monedaEnTexto_(val(r, 'inversion')) || monedaHoja ||
        (lista_('marcas_en_soles').indexOf(marca) >= 0 ? 'PEN' : 'USD');
      filas.push({
        moneda: moneda,
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
      const monedas = Array.from(new Set(filas.map(x => x.moneda))).join('/');
      estados[f.id] = { estado: 'OK' + (monedas ? ' · ' + monedas : ''), filas: filas.length };
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
  const hoy = hoy_();
  const a1 = sumarDias_(hoy, -6);
  const b0 = sumarDias_(hoy, -13);
  const b1 = sumarDias_(hoy, -7);
  const filas = leerTabla_('Pauta_diaria').filter(r => r.fecha >= b0 && r.fecha <= hoy);
  const out = [];
  Array.from(new Set(filas.map(r => r.marca))).forEach(m => {
    const a = totales_(filas.filter(r => r.marca === m && r.fecha >= a1));
    const b = totales_(filas.filter(r => r.marca === m && r.fecha >= b0 && r.fecha <= b1));
    if (a.inversion > 0 && !a.resultados) out.push(m + ': ' + montoTexto_(a) + ' invertidos en 7 días sin resultados registrados');
    const vi = variacion_(a.inversion, b.inversion);
    if (vi !== null && Math.abs(vi) >= umbral) out.push(m + ': la inversión ' + (vi > 0 ? 'subió ' : 'bajó ') + Math.abs(vi) + '% vs. la semana anterior');
    const vc = variacion_(a.cpr, b.cpr);
    if (vc !== null && vc >= umbral) out.push(m + ': el costo por resultado subió ' + vc + '% vs. la semana anterior');
  });
  return out;
}

/* ---------- Informe ejecutivo ---------- */

/**
 * Suma métricas sin convertir monedas. Los montos se separan por moneda en t.monedas;
 * t.moneda es 'PEN', 'USD', 'MIXTA' (soles y dólares juntos) o null (sin datos).
 * Los indicadores en dinero del total (inversion, cpr, cpm, cpc) solo valen si no es MIXTA.
 */
function totales_(filas) {
  const t = { inversion: 0, alcance: 0, impresiones: 0, clics: 0, resultados: 0, leads: 0, mensajes: 0, monedas: {} };
  filas.forEach(r => {
    ['alcance', 'impresiones', 'clics', 'leads', 'mensajes'].forEach(k => { t[k] += Number(r[k]) || 0; });
    const res = (Number(r.resultados) || 0) > 0 ? Number(r.resultados) : (Number(r.leads) || 0) + (Number(r.mensajes) || 0);
    const inv = Number(r.inversion) || 0;
    t.resultados += res;
    t.inversion += inv;
    const m = r.moneda || 'PEN';
    const g = t.monedas[m] = t.monedas[m] || { inversion: 0, resultados: 0, impresiones: 0, clics: 0 };
    g.inversion += inv;
    g.resultados += res;
    g.impresiones += Number(r.impresiones) || 0;
    g.clics += Number(r.clics) || 0;
  });
  const r2 = n => Math.round(n * 100) / 100;
  Object.keys(t.monedas).forEach(m => {
    const g = t.monedas[m];
    g.inversion = r2(g.inversion);
    g.cpr = g.resultados ? r2(g.inversion / g.resultados) : null;
    g.cpm = g.impresiones ? r2(g.inversion / g.impresiones * 1000) : null;
    g.cpc = g.clics ? r2(g.inversion / g.clics) : null;
  });
  const lista = Object.keys(t.monedas);
  t.moneda = lista.length === 1 ? lista[0] : lista.length ? 'MIXTA' : null;
  const unica = t.moneda && t.moneda !== 'MIXTA' ? t.monedas[t.moneda] : null;
  t.inversion = r2(t.inversion);
  t.cpr = unica ? unica.cpr : null;
  t.cpm = unica ? unica.cpm : null;
  t.cpc = unica ? unica.cpc : null;
  t.ctr = t.impresiones ? r2(t.clics / t.impresiones * 100) : null;
  return t;
}

const variacion_ = (a, b) => (b ? Math.round((a - b) / b * 1000) / 10 : null);

/** Variación de un monto por moneda: { PEN: %, USD: % }. */
function variacionPorMoneda_(a, b, campo) {
  const v = {};
  MONEDAS.forEach(m => {
    if (a.monedas[m] && b.monedas[m]) v[m] = variacion_(a.monedas[m][campo], b.monedas[m][campo]);
  });
  return v;
}

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
  const tot = totales_;
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
  const tA = tot(actual);
  const tB = tot(anterior);

  // Serie del periodo (rellena los huecos).
  const serie = [];
  const grupos = {};
  actual.forEach(r => { (grupos[clavePeriodo_(r.fecha, gran)] = grupos[clavePeriodo_(r.fecha, gran)] || []).push(r); });
  for (let f = desde; f <= hasta; f = sumarDias_(f, 1)) {
    const k = clavePeriodo_(f, gran);
    if (!serie.length || serie[serie.length - 1].k !== k) serie.push({ k: k, t: tot(grupos[k] || []) });
  }

  // Histórico: 12 meses hasta el mes de «hasta».
  const historico = [];
  let mes = hasta.slice(0, 7);
  for (let i = 0; i < 12; i++) { historico.unshift(mes); mes = mesAnterior_(mes); }
  const porMes = {};
  pauta.forEach(r => { (porMes[r.fecha.slice(0, 7)] = porMes[r.fecha.slice(0, 7)] || []).push(r); });
  const hist = historico.map(m => ({ k: m, t: tot(porMes[m] || []) }));
  // Promedio histórico del costo por resultado: solo si todo está en una misma moneda.
  const previos = hist.filter(h => h.k < desde.slice(0, 7) && h.t.resultados > 0).slice(-6);
  const mismaMoneda = tA.moneda && tA.moneda !== 'MIXTA' && previos.every(h => h.t.moneda === tA.moneda);
  const cprHistorico = previos.length && mismaMoneda ? Math.round(previos.reduce((s, h) => s + h.t.inversion, 0) / previos.reduce((s, h) => s + h.t.resultados, 0) * 100) / 100 : null;

  const marcas = lista_('marcas');
  const porMarca = marcas.concat(Object.keys(actual.reduce((o, r) => { if (marcas.indexOf(r.marca) < 0) o[r.marca] = 1; return o; }, {})))
    .filter(m => !marca || m === marca)
    .map(m => ({ marca: m, actual: tot(actual.filter(r => r.marca === m)), anterior: tot(anterior.filter(r => r.marca === m)) }))
    .filter(x => x.actual.inversion || x.anterior.inversion);

  const camp = {};
  actual.forEach(r => { const k = r.marca + '|' + r.campana; (camp[k] = camp[k] || []).push(r); });
  const campanas = Object.keys(camp).map(k => Object.assign({ marca: k.split('|')[0], campana: k.split('|').slice(1).join('|') }, tot(camp[k])))
    .sort((a, b) => b.inversion - a.inversion);


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
    variacionesPorMoneda: { inversion: variacionPorMoneda_(tA, tB, 'inversion'), cpr: variacionPorMoneda_(tA, tB, 'cpr') },
    simbolos: SIMBOLO,
    serie: serie, historico: hist, porMarca: porMarca, campanas: campanas.slice(0, 15),
    hayPauta: pauta.length > 0
  };
  informe.interpretaciones = interpretar_(informe, campanas);
  return informe;
}




/** Lecturas automáticas en lenguaje simple para el informe. */
function interpretar_(inf, campanas) {
  const sim = m => SIMBOLO[m] + ' ';
  const n = v => Number(v).toLocaleString('es-PE', { maximumFractionDigits: 2 });
  const n2 = v => Number(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = v => (v > 0 ? '+' : '') + n(v) + '%';
  const t = inf.totales;
  const v = inf.variaciones;
  const out = [];

  if (!inf.hayPauta) {
    out.push({ tono: 'neutro', texto: 'Aún no hay datos de pauta. Vincula tus Google Sheets de pauta en «Fuentes de datos».' });
  } else if (!t.inversion) {
    out.push({ tono: 'neutro', texto: 'No hubo inversión en pauta en este periodo.' });
  } else {
    // Cada moneda se analiza por separado: los montos en soles y en dólares no se suman ni se convierten.
    const monedas = MONEDAS.filter(m => t.monedas[m]);
    const varias = monedas.length > 1;
    const vi = inf.variacionesPorMoneda.inversion;
    const vc = inf.variacionesPorMoneda.cpr;
    const nombreMoneda = m => (m === 'PEN' ? 'soles' : 'dólares');
    out.push({ tono: 'neutro', texto: 'Se invirtieron ' +
      monedas.map(m => sim(m) + n2(t.monedas[m].inversion) + (vi[m] !== undefined && vi[m] !== null ? ' (' + pct(vi[m]) + ' vs. el periodo anterior)' : '')).join(' + ') +
      ' y se obtuvieron ' + n(t.resultados) + ' resultados.' + (varias ? ' Los montos en soles y en dólares se informan por separado.' : '') });

    monedas.forEach(m => {
      const g = t.monedas[m];
      if (g.cpr === null) return;
      let txt = (varias ? 'En las cuentas en ' + nombreMoneda(m) + ', cada' : 'Cada') + ' resultado costó en promedio ' + sim(m) + n2(g.cpr);
      let tono = 'neutro';
      const x = vc[m];
      if (x !== undefined && x !== null) {
        txt += x < 0 ? ', ' + n(Math.abs(x)) + '% más barato que el periodo anterior' : x > 0 ? ', ' + n(x) + '% más caro que el periodo anterior' : ', igual que el periodo anterior';
        tono = x <= -5 ? 'bueno' : x >= 5 ? 'malo' : 'neutro';
      }
      if (!varias && inf.cprHistorico) {
        const d = Math.round((g.cpr - inf.cprHistorico) / inf.cprHistorico * 100);
        txt += '. Frente al promedio de los últimos meses (' + sim(m) + n2(inf.cprHistorico) + ') está ' + (d <= 0 ? n(Math.abs(d)) + '% por debajo' : n(d) + '% por encima');
      }
      out.push({ tono: tono, texto: txt + '.' });
    });

    if (v.ctr !== null && Math.abs(v.ctr) >= 10) {
      out.push({ tono: v.ctr > 0 ? 'bueno' : 'malo', texto: 'La tasa de clics (CTR) ' + (v.ctr > 0 ? 'mejoró ' : 'bajó ') + n(Math.abs(v.ctr)) + '%: los anuncios ' + (v.ctr > 0 ? 'están captando más' : 'están captando menos') + ' la atención.' });
    }

    // Eficiencia entre marcas: solo se comparan marcas que pautan en la misma moneda.
    monedas.forEach(m => {
      const grupo = inf.porMarca.filter(x => x.actual.moneda === m && x.actual.cpr !== null && x.actual.inversion >= t.monedas[m].inversion * 0.05);
      if (grupo.length < 2) return;
      const orden = grupo.slice().sort((a, b) => a.actual.cpr - b.actual.cpr);
      const sufijo = varias ? ' (entre las cuentas en ' + nombreMoneda(m) + ')' : '';
      out.push({ tono: 'bueno', texto: orden[0].marca + ' es la marca más eficiente' + sufijo + ': ' + sim(m) + n2(orden[0].actual.cpr) + ' por resultado.' });
      out.push({ tono: 'malo', texto: orden[orden.length - 1].marca + ' tiene el costo por resultado más alto' + sufijo + ': ' + sim(m) + n2(orden[orden.length - 1].actual.cpr) + '.' });
    });

    const relevante = c => c.moneda && c.moneda !== 'MIXTA' && t.monedas[c.moneda] && c.inversion >= t.monedas[c.moneda].inversion * 0.05;
    const sinRes = campanas.filter(c => relevante(c) && c.inversion >= 50 && !c.resultados);
    if (sinRes.length) {
      out.push({ tono: 'malo', texto: 'Revisar: ' + sinRes.slice(0, 3).map(c => '«' + c.campana + '» (' + c.marca + ', ' + montoTexto_(c) + ')').join(', ') + ' invirtieron sin resultados registrados.' });
    }
    monedas.forEach(m => {
      const top = campanas.filter(c => c.moneda === m && c.cpr !== null && relevante(c)).sort((a, b) => a.cpr - b.cpr)[0];
      if (top) out.push({ tono: 'bueno', texto: 'Campaña destacada: «' + top.campana + '» (' + top.marca + ') con ' + n(top.resultados) + ' resultados a ' + sim(m) + n2(top.cpr) + ' cada uno.' });
    });
  }

  return out;
}
