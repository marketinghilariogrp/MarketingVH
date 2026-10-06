/** Punto de entrada de la web app. */

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('MarketingVH · Gestión de equipo')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/** Todo lo que la interfaz necesita al abrir, en una sola llamada. */
function getInicio(token) {
  const u = sesion_(token);
  const cfg = config_();
  return {
    usuario: publico_(u),
    cfg: {
      areas: String(cfg.areas || '').split(',').map(s => s.trim()).filter(String),
      coordinadorPuedeAprobar: cfg.coordinador_puede_aprobar === 'SI',
      jornadaHoras: Number(cfg.jornada_horas) || 8
    },
    usuarios: esGestor_(u) ? usuarios_().filter(x => x.activo === 'SI').map(publico_) : [],
    hoy: hoy_(),
    tareas: tareasPara_(u)
  };
}
