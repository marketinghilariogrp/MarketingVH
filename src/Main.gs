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
  const gestor = esGestor_(u);
  return {
    usuario: publico_(u),
    cfg: {
      areas: lista_('areas'),
      marcas: lista_('marcas'),
      funciones: lista_('funciones'),
      funcionesEvento: lista_('funciones_evento'),
      tiposAgenda: lista_('tipos_agenda'),
      tiposAgendaPersonal: lista_('tipos_agenda_personal'),
      marcaHoras: marcaHoras_(u),
      coordinadorPuedeAprobar: cfg.coordinador_puede_aprobar === 'SI',
      jornadaHoras: Number(cfg.jornada_horas) || 8,
      moneda: cfg.moneda || 'S/'
    },
    // Todos ven nombres y áreas (para calendario y eventos); el correo solo lo ven los gestores.
    usuarios: usuarios_().filter(x => x.activo === 'SI').map(x => {
      const p = publico_(x);
      if (!gestor) delete p.correo;
      p.cubreEventos = cubreEventos_(x);
      p.marcaHoras = marcaHoras_(x);
      return p;
    }),
    hoy: hoy_(),
    tareas: tareasPara_(u),
    notificaciones: leerTabla_('Notificaciones').filter(n => n.usuario_id === u.id && n.leida !== 'SI').length
  };
}
