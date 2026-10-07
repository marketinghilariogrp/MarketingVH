/**
 * Importación única del Excel «Rotacion Eventos 2026 VH Holding» (feb–oct 2026).
 * Ejecutar importarRotacion2026() UNA vez desde el editor, después de setup().
 * Crea a las personas que aún no existen (sin correo: no pueden ingresar hasta que el admin les ponga uno)
 * y a los practicantes Renzo y Abigail.
 */

const AREA_IMPORTADA = {
  Fran: 'Audiovisual', Jorge: 'Audiovisual', Jefferson: 'Audiovisual', Challs: 'Audiovisual', Anthony: 'Audiovisual',
  Henz: 'Community Manager', Rodrigo: 'Community Manager'
};

const PRACTICANTES = ['Renzo', 'Abigail'];

// [fecha, evento, empresa, [[persona, función]], nota]
const ROTACION_2026 = [
  ["2026-02-01", "Visita Proyecto*", "Vyc", [["Fran", "Audiovisual"], ["Jorge", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-02-03", "After Office", "Academia", [["Jefferson", "Audiovisual"], ["Rodrigo", "CM"]], ""],
  ["2026-02-05", "Evento Salhi", "Nexo", [["Fran", "Audiovisual"]], ""],
  ["2026-02-06", "Captación Asesores", "Nexo", [["Challs", "Audiovisual"], ["Jorge", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-02-08", "Visita Proyecto*", "Vyc", [], ""],
  ["2026-02-10", "After Office", "Academia", [["Challs", "Audiovisual"], ["Rodrigo", "CM"]], ""],
  ["2026-02-15", "Visita Proyecto*", "Vyc", [["Fran", "Audiovisual"]], ""],
  ["2026-02-17", "Círculo 50K", "Marca Personal", [["Challs", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-02-19", "After Office", "Academia", [["Jefferson", "Audiovisual"], ["Rodrigo", "CM"]], ""],
  ["2026-02-21", "Full Day*", "Nexo", [["Fran", "Audiovisual"], ["Jorge", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-02-28", "Educacion Prohibida", "Academia", [["Fran", "Audiovisual"], ["Jorge", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-03-01", "Visita Proyecto*", "Nexo", [], "Todo el equipo"],
  ["2026-03-05", "After Office", "Academia", [["Fran", "Audiovisual"], ["Jorge", "Audiovisual"]], ""],
  ["2026-03-06", "Zoom Lanzamiento Paraiso Frutal", "Nexo", [["Jefferson", "Audiovisual"], ["Challs", "Audiovisual"]], "Todo el equipo"],
  ["2026-03-07", "Captación Asesores", "Nexo", [["Jefferson", "Audiovisual"], ["Fran", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-03-08", "Visita Proyecto*", "Nexo", [["Challs", "Audiovisual"], ["Rodrigo", "CM"]], ""],
  ["2026-03-10", "After Office", "Academia", [["Fran", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-03-12", "Podcast Invitación", "Academia", [["Jefferson", "Audiovisual"], ["Challs", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-03-13", "Circulo 50K", "Marca Personal", [["Fran", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-03-13", "Zoom Lanzamiento Paraiso Frutal", "Nexo", [["Challs", "Audiovisual"], ["Jefferson", "Audiovisual"], ["Rodrigo", "CM"]], ""],
  ["2026-03-15", "Visita Proyecto*", "Nexo", [["Fran", "Audiovisual"], ["Jorge", "Audiovisual"], ["Henz", "CM"]], "evento nadie fue de markting"],
  ["2026-03-18", "Educación Prohibida", "Academia", [["Jefferson", "Audiovisual"], ["Challs", "Audiovisual"], ["Rodrigo", "CM"]], ""],
  ["2026-03-22", "Visita Proyecto*", "Vyc", [["Jorge", "Audiovisual"], ["Fran", "Audiovisual"]], ""],
  ["2026-03-24", "After Office", "Academia", [["Jorge", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-03-27", "Stream", "Vyc", [["Jefferson", "Audiovisual"], ["Challs", "Audiovisual"]], "Todo el equipo"],
  ["2026-03-28", "Full Day Nexo", "Nexo", [["Fran", "Audiovisual"], ["Jorge", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-03-29", "Visita Proyecto*", "Vyc", [["Jefferson", "Audiovisual"], ["Challs", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-03-31", "Academia", "Academia", [["Fran", "Audiovisual"], ["Rodrigo", "CM"]], ""],
  ["2026-04-05", "Visita los domingos", "Nexo", [["Fran", "Audiovisual"], ["Jorge", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-04-07", "Academia", "Academia", [["Fran", "Audiovisual"], ["Rodrigo", "CM"]], ""],
  ["2026-04-08", "Nexo", "Nexo", [["Jefferson", "Audiovisual"], ["Challs", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-04-10", "Stream", "Nexo", [["Jefferson", "Audiovisual"], ["Challs", "Audiovisual"]], ""],
  ["2026-04-14", "Academia", "Academia", [["Fran", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-04-17", "Stream", "Nexo", [["Jefferson", "Audiovisual"], ["Challs", "Audiovisual"]], "Todo el equipo"],
  ["2026-04-18", "Stream", "Academia", [["Challs", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-04-19", "Visita domingos", "Vyc", [["Fran", "Audiovisual"], ["Jorge", "Audiovisual"], ["Rodrigo", "CM"]], ""],
  ["2026-04-25", "GIRA AREQUIPA", "Academia", [["Jefferson", "Audiovisual"], ["Rodrigo", "CM"]], ""],
  ["2026-04-30", "Coffee break", "Academia", [["Challs", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-05-01", "Asesores day", "Nexo", [["Fran", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-05-06", "Coffee break", "Academia", [["Fran", "Audiovisual"], ["Jorge", "Audiovisual"]], ""],
  ["2026-05-08", "Stream nexo", "Nexo", [["Jefferson", "Audiovisual"], ["Challs", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-05-09", "Viaje a Paracas", "Nexo", [["Jefferson", "Audiovisual"], ["Fran", "Audiovisual"]], ""],
  ["2026-05-12", "Coffee break", "Academia", [["Fran", "Audiovisual"], ["Rodrigo", "CM"]], ""],
  ["2026-05-15", "Renacer del asesor", "Nexo", [["Jefferson", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-05-19", "Coffee break", "Academia", [["Fran", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-05-22", "Stream nexo", "Nexo", [["Jefferson", "Audiovisual"], ["Fran", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-05-26", "Coffee break", "Academia", [["Fran", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-05-29", "Evento de asesores", "Nexo", [["Fran", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-06-02", "Coffee break", "Academia", [], ""],
  ["2026-06-04", "Circulo 50k reunion", "Marca Personal", [["Anthony", "Audiovisual"]], ""],
  ["2026-06-05", "Stream", "Nexo", [["Jefferson", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-06-09", "Educación prohibida", "Academia", [["Jefferson", "Audiovisual"], ["Anthony", "Audiovisual"]], ""],
  ["2026-06-13", "Renacer del asesor", "Nexo", [["Jefferson", "Audiovisual"], ["Henz", "CM"], ["Rodrigo", "CM"]], ""],
  ["2026-06-14", "Visita proyecto", "Nexo", [["Jefferson", "Audiovisual"], ["Challs", "Audiovisual"]], ""],
  ["2026-06-16", "Educación prohibida", "Academia", [], ""],
  ["2026-06-17", "Stream oro berry", "Vyc", [["Jefferson", "Audiovisual"], ["Anthony", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-06-23", "Coffee break", "Academia", [], ""],
  ["2026-06-24", "Circulo 50k 3.0", "Marca Personal", [["Challs", "Audiovisual"], ["Jefferson", "Audiovisual"], ["Anthony", "Audiovisual"], ["Rodrigo", "CM"], ["Henz", "CM"]], ""],
  ["2026-06-27", "Gira Cajamarca", "Academia", [], ""],
  ["2026-07-01", "Coffee break", "Academia", [["Jefferson", "Audiovisual"], ["Anthony", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-07-03", "Evento externo", "Marca Personal", [["Jefferson", "Audiovisual"], ["Anthony", "Audiovisual"]], ""],
  ["2026-07-05", "Visita proyecto huaral", "Nexo", [["Jorge", "Audiovisual"], ["Rodrigo", "CM"]], ""],
  ["2026-07-07", "Coffee break", "Academia", [["Challs", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-07-10", "Circulo 50k 3.0", "Marca Personal", [["Challs", "Audiovisual"], ["Jefferson", "Audiovisual"], ["Jorge", "Audiovisual"], ["Anthony", "Audiovisual"], ["Rodrigo", "CM"], ["Henz", "CM"]], ""],
  ["2026-07-11", "Reunion circulo 50k 3.0", "Marca Personal", [["Challs", "Audiovisual"], ["Jefferson", "Audiovisual"], ["Jorge", "Audiovisual"], ["Anthony", "Audiovisual"], ["Henz", "CM"]], ""],
  ["2026-07-14", "Coffee break", "Academia", [["Jefferson", "Audiovisual"], ["Anthony", "Audiovisual"]], ""],
  ["2026-07-17", "Renacer del asesor", "Nexo", [], ""],
  ["2026-07-19", "Visita proyecto hdn", "Vyc", [["Challs", "Audiovisual"], ["Jefferson", "Audiovisual"], ["Anthony", "Audiovisual"], ["Henz", "CM"], ["Rodrigo", "CM"]], ""],
  ["2026-07-21", "Coffee break", "Academia", [], ""],
  ["2026-07-24", "Stream nexo", "Academia", [], ""],
  ["2026-07-25", "Evento Nexo", "Nexo", [], ""],
  ["2026-07-26", "Visita proyecto pf", "Nexo", [], ""],
  ["2026-07-31", "Stream nexo", "Academia", [], ""],
  ["2026-10-01", "Stream / Zoom", "EDE", [["Jefferson", "Audiovisual"], ["Anthony", "Audiovisual"]], ""],
  ["2026-10-02", "Cóctel Empresarial", "Vyc", [["Blue", "Apoyo"], ["Rodrigo", "CM"], ["Gabriela", "Apoyo"]], ""],
  ["2026-10-11", "Evento Proyecto", "Nexo", [["Blue", "Apoyo"], ["Rodrigo", "CM"], ["Gabriela", "Apoyo"]], ""],
  ["2026-10-12", "Stream / Zoom", "EDE", [["Anthony", "Audiovisual"], ["Jefferson", "Audiovisual"]], ""],
  ["2026-10-15", "Academia x Nexo", "Academia", [["Anthony", "Audiovisual"], ["Jefferson", "Audiovisual"], ["Gabriela", "Apoyo"]], ""],
  ["2026-10-22", "Stream / Zoom", "EDE", [["Jefferson", "Audiovisual"], ["Anthony", "Audiovisual"], ["Blue", "Apoyo"]], ""],
  ["2026-10-26", "Stream / Zoom", "EDE", [["Jefferson", "Audiovisual"], ["Anthony", "Audiovisual"], ["Rodrigo", "CM"]], ""]
];

function importarRotacion2026() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('IMPORT_ROTACION_2026')) throw new Error('La rotación 2026 ya fue importada.');
  const hoy = hoy_();
  const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/)[0];

  conLock_(() => {
    const usuarios = leerTabla_('Usuarios');
    const porNombre = {};
    usuarios.forEach(x => { porNombre[norm(x.nombre)] = x; });
    const nuevosUsuarios = [];
    const persona = (nombre, rol, area) => {
      const k = norm(nombre);
      if (!porNombre[k]) {
        porNombre[k] = { id: uuid_(), nombre: nombre, correo: '', rol: rol, area: area || '', pin_hash: '',
          jornada_horas: config_().jornada_horas || '8', activo: 'SI', creado: ahora_() };
        nuevosUsuarios.push(porNombre[k]);
      }
      return porNombre[k].id;
    };
    PRACTICANTES.forEach(n => persona(n, 'practicante', ''));

    const marcas = lista_('marcas');
    const eventos = [];
    const cobertura = [];
    ROTACION_2026.forEach(r => {
      const realizado = r[0] < hoy;
      const ev = { id: uuid_(), fecha: r[0], titulo: r[1], detalle: r[4], lugar: '', calendar_id: '',
        estado: realizado ? 'realizado' : 'programado', empresa: r[2], hora_inicio: '', hora_fin: '',
        creado_por: 'importacion', actualizada: ahora_() };
      if (r[2] && marcas.indexOf(r[2]) < 0) marcas.push(r[2]);
      eventos.push(ev);
      r[3].forEach(p => cobertura.push({ id: uuid_(), evento_id: ev.id, usuario_id: persona(p[0], 'colaborador', AREA_IMPORTADA[p[0]]),
        rol_en_evento: p[1], estado: realizado ? 'cubierto' : 'asignado', zona: '', horario: '', nota: '' }));
    });

    agregarFilas_('Usuarios', nuevosUsuarios);
    agregarFilas_('Eventos', eventos);
    agregarFilas_('Cobertura', cobertura);
    const cfg = leerTabla_('Config').find(c => c.clave === 'marcas');
    if (cfg) { cfg.valor = marcas.join(','); escribirFila_('Config', cfg); }
    log_('sistema', 'importar_rotacion', '', eventos.length + ' eventos, ' + cobertura.length + ' coberturas, ' +
      nuevosUsuarios.length + ' personas nuevas');
    console.log('Importados ' + eventos.length + ' eventos y ' + cobertura.length + ' asignaciones.');
    console.log('Personas creadas: ' + (nuevosUsuarios.map(x => x.nombre).join(', ') || 'ninguna'));
  });
  invalidar_('usuarios');
  invalidar_('config');
  props.setProperty('IMPORT_ROTACION_2026', ahora_());
}
