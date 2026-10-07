/**
 * Reporte diario de pauta de Meta Ads (corte 6:00 p. m., hora de Lima).
 * Requiere la propiedad del script META_TOKEN (token de usuario del sistema con permiso ads_read).
 * Las cuentas se configuran en Config.meta_cuentas como «id:Nombre;id:Nombre».
 */

function metaCuentas_() {
  return String(config_().meta_cuentas || '').split(';').map(s => s.trim()).filter(String).map(s => {
    const i = s.indexOf(':');
    return { id: s.slice(0, i).trim(), nombre: s.slice(i + 1).trim() };
  });
}

function metaGet_(ruta, params) {
  const token = PropertiesService.getScriptProperties().getProperty('META_TOKEN');
  if (!token) throw new Error('Falta configurar META_TOKEN en las propiedades del script.');
  const version = config_().meta_api_version || 'v24.0';
  const qs = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  let url = 'https://graph.facebook.com/' + version + '/' + ruta + '?' + qs + '&access_token=' + encodeURIComponent(token);
  const datos = [];
  while (url) {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText());
    if (json.error) throw new Error('Meta: ' + json.error.message);
    (json.data || []).forEach(x => datos.push(x));
    url = json.paging && json.paging.next ? json.paging.next : null;
  }
  return datos;
}

function accion_(acciones, tipos) {
  for (let i = 0; i < tipos.length; i++) {
    const a = (acciones || []).find(x => x.action_type === tipos[i]);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

/** Descarga las métricas de una fecha (yyyy-MM-dd) de todas las cuentas y las guarda en Pauta_diaria. */
function actualizarPauta_(fecha) {
  const filas = [];
  const errores = [];
  metaCuentas_().forEach(cuenta => {
    try {
      const activas = metaGet_('act_' + cuenta.id + '/campaigns', {
        fields: 'id,name,effective_status,objective',
        effective_status: JSON.stringify(['ACTIVE']),
        limit: 200
      });
      const insights = metaGet_('act_' + cuenta.id + '/insights', {
        level: 'campaign',
        time_range: JSON.stringify({ since: fecha, until: fecha }),
        fields: 'campaign_id,campaign_name,objective,spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc,cpm,actions',
        limit: 500
      });
      const vistas = {};
      insights.forEach(x => {
        vistas[x.campaign_id] = true;
        const activa = activas.find(c => c.id === x.campaign_id);
        filas.push({
          fecha: fecha, cuenta_id: cuenta.id, cuenta: cuenta.nombre, campana_id: x.campaign_id, campana: x.campaign_name,
          estado: activa ? 'ACTIVE' : 'INACTIVA', objetivo: x.objective || '',
          inversion: x.spend || 0, impresiones: x.impressions || 0, alcance: x.reach || 0, clics: x.clicks || 0,
          clics_enlace: x.inline_link_clicks || 0, ctr: x.ctr || 0, cpc: x.cpc || 0, cpm: x.cpm || 0,
          leads: accion_(x.actions, ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']),
          mensajes: accion_(x.actions, ['onsite_conversion.messaging_conversation_started_7d']),
          actualizado: ahora_()
        });
      });
      // Campañas activas que hoy no gastaron: también se registran (inversión 0) para detectarlas.
      activas.filter(c => !vistas[c.id]).forEach(c => filas.push({
        fecha: fecha, cuenta_id: cuenta.id, cuenta: cuenta.nombre, campana_id: c.id, campana: c.name,
        estado: 'ACTIVE', objetivo: c.objective || '', inversion: 0, impresiones: 0, alcance: 0, clics: 0,
        clics_enlace: 0, ctr: 0, cpc: 0, cpm: 0, leads: 0, mensajes: 0, actualizado: ahora_()
      }));
    } catch (e) {
      errores.push(cuenta.nombre + ': ' + e.message);
    }
  });

  conLock_(() => {
    const existentes = {};
    leerTabla_('Pauta_diaria').forEach(r => { existentes[r.fecha + '|' + r.campana_id] = r; });
    const nuevas = [];
    filas.forEach(f => {
      const r = existentes[f.fecha + '|' + f.campana_id];
      if (r) { Object.assign(r, f); escribirFila_('Pauta_diaria', r); } else nuevas.push(f);
    });
    agregarFilas_('Pauta_diaria', nuevas);
    log_('sistema', 'pauta_meta', fecha, filas.length + ' campañas' + (errores.length ? ' · errores: ' + errores.join(' | ') : ''));
  });
  return { filas: filas.length, errores: errores };
}

/** Totales por cuenta y día a partir de Pauta_diaria. */
function resumenPauta_(desde, hasta) {
  const porDia = {};
  leerTabla_('Pauta_diaria').filter(r => r.fecha >= desde && r.fecha <= hasta).forEach(r => {
    const k = r.cuenta_id + '|' + r.fecha;
    const t = porDia[k] = porDia[k] || { cuenta_id: r.cuenta_id, cuenta: r.cuenta, fecha: r.fecha,
      inversion: 0, impresiones: 0, alcance: 0, clics_enlace: 0, leads: 0, mensajes: 0, activas: 0 };
    t.inversion += Number(r.inversion) || 0;
    t.impresiones += Number(r.impresiones) || 0;
    t.alcance += Number(r.alcance) || 0;
    t.clics_enlace += Number(r.clics_enlace) || 0;
    t.leads += Number(r.leads) || 0;
    t.mensajes += Number(r.mensajes) || 0;
    if (r.estado === 'ACTIVE') t.activas++;
  });
  return Object.keys(porDia).map(k => porDia[k]);
}

/** Compara el día con el promedio de los 7 días anteriores y marca variaciones fuertes. */
function variacionesPauta_(fecha) {
  const umbral = (Number(config_().umbral_variacion) || 30) / 100;
  const datos = resumenPauta_(sumarDias_(fecha, -7), fecha);
  const alertas = [];
  metaCuentas_().forEach(c => {
    const hoy = datos.find(x => x.cuenta_id === c.id && x.fecha === fecha);
    const previos = datos.filter(x => x.cuenta_id === c.id && x.fecha < fecha);
    if (!hoy || !previos.length) return;
    const prom = k => previos.reduce((s, x) => s + x[k], 0) / previos.length;
    const res = x => x.leads + x.mensajes;
    const invProm = prom('inversion');
    const resProm = previos.reduce((s, x) => s + res(x), 0) / previos.length;
    if (invProm > 0 && Math.abs(hoy.inversion - invProm) / invProm > umbral) {
      alertas.push(c.nombre + ': inversión ' + (hoy.inversion > invProm ? 'subió' : 'bajó') + ' ' +
        Math.round(Math.abs(hoy.inversion - invProm) / invProm * 100) + '% vs. promedio de 7 días');
    }
    if (resProm > 0 && hoy.inversion > 0) {
      const cprHoy = res(hoy) ? hoy.inversion / res(hoy) : null;
      const cprProm = invProm / resProm;
      if (cprHoy === null) alertas.push(c.nombre + ': invirtió ' + (config_().moneda || 'S/') + ' ' + hoy.inversion.toFixed(2) + ' sin resultados hoy');
      else if ((cprHoy - cprProm) / cprProm > umbral) {
        alertas.push(c.nombre + ': costo por resultado subió ' + Math.round((cprHoy - cprProm) / cprProm * 100) + '%');
      }
    }
  });
  return alertas;
}

/** Trigger diario (6:00 p. m.): descarga el corte del día y envía el reporte por correo. */
function pautaDiaria() {
  const fecha = hoy_();
  const r = actualizarPauta_(fecha);
  enviarReportePauta_(fecha, r.errores);
}

function enviarReportePauta_(fecha, errores) {
  const destinatarios = lista_('correos_reporte').join(',');
  if (!destinatarios) return;
  const filas = resumenPauta_(fecha, fecha);
  const alertas = variacionesPauta_(fecha);
  const n = v => Number(v).toLocaleString('es-PE', { maximumFractionDigits: 2 });
  const mon = (config_().moneda || 'S/') + ' ';
  const celda = 'style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:right"';
  const html = '<h2 style="font-family:sans-serif">Pauta Meta Ads · corte ' + fecha + ' 6:00 p. m.</h2>' +
    '<table style="border-collapse:collapse;font-family:sans-serif;font-size:13px">' +
    '<tr><th align="left">Cuenta</th><th>Inversión</th><th>Impresiones</th><th>Alcance</th><th>Clics enlace</th>' +
    '<th>Leads</th><th>Mensajes</th><th>Costo/resultado</th><th>Campañas activas</th></tr>' +
    filas.map(f => '<tr><td style="padding:6px 10px;border-bottom:1px solid #ddd">' + escHtml_(f.cuenta) + '</td>' +
      '<td ' + celda + '>' + mon + n(f.inversion) + '</td><td ' + celda + '>' + n(f.impresiones) + '</td>' +
      '<td ' + celda + '>' + n(f.alcance) + '</td><td ' + celda + '>' + n(f.clics_enlace) + '</td>' +
      '<td ' + celda + '>' + n(f.leads) + '</td><td ' + celda + '>' + n(f.mensajes) + '</td>' +
      '<td ' + celda + '>' + (f.leads + f.mensajes ? mon + n(f.inversion / (f.leads + f.mensajes)) : '—') + '</td>' +
      '<td ' + celda + '>' + f.activas + '</td></tr>').join('') +
    '</table>' +
    (alertas.length ? '<h3 style="font-family:sans-serif">Revisar</h3><ul>' + alertas.map(a => '<li>' + escHtml_(a) + '</li>').join('') + '</ul>' : '') +
    (errores && errores.length ? '<p style="color:#b91c1c">Errores: ' + errores.join(' | ') + '</p>' : '');
  MailApp.sendEmail({ to: destinatarios, subject: 'Pauta Meta Ads · ' + fecha, htmlBody: html });
}

/** Para la vista Pauta. */
function getPauta(token, fecha) {
  const u = sesion_(token);
  exigirGestor_(u);
  fecha = texto_(fecha, 10);
  if (!esFecha_(fecha)) throw new Error('Fecha no válida.');
  return {
    configurado: !!PropertiesService.getScriptProperties().getProperty('META_TOKEN'),
    cuentas: metaCuentas_(),
    campanas: leerTabla_('Pauta_diaria').filter(r => r.fecha === fecha).map(r => {
      const o = {};
      ESQUEMA.Pauta_diaria.forEach(c => { o[c] = r[c]; });
      return o;
    }),
    tendencia: resumenPauta_(sumarDias_(fecha, -13), fecha),
    alertas: variacionesPauta_(fecha)
  };
}

/** Botón «Actualizar ahora» (solo admin). */
function actualizarPautaAhora(token, fecha) {
  const u = sesion_(token);
  exigirAdmin_(u);
  fecha = texto_(fecha, 10);
  if (!esFecha_(fecha) || fecha > hoy_()) throw new Error('Fecha no válida.');
  return actualizarPauta_(fecha);
}

/** Prueba desde el editor: muestra las cuentas a las que el token tiene acceso. */
function probarMeta() {
  metaCuentas_().forEach(c => {
    try {
      const d = metaGet_('act_' + c.id + '/campaigns', { fields: 'name,effective_status', limit: 5 });
      console.log('OK ' + c.nombre + ' · ' + d.length + ' campañas (muestra)');
    } catch (e) {
      console.log('ERROR ' + c.nombre + ': ' + e.message);
    }
  });
}
