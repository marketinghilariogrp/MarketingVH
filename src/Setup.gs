/**
 * Instalación y actualización. Ejecutar setup() desde el editor de Apps Script:
 * - la primera vez crea el archivo de datos, las hojas, la configuración y el administrador;
 * - las siguientes veces solo agrega hojas, columnas y claves de Config nuevas (no borra nada).
 */

const CONFIG_INICIAL = [
  ['peso_alta', '3', 'Peso de producción de una tarea de prioridad alta'],
  ['peso_media', '2', 'Peso de producción de una tarea de prioridad media'],
  ['peso_baja', '1', 'Peso de producción de una tarea de prioridad baja'],
  ['jornada_horas', '8', 'Horas de jornada por defecto'],
  ['horario_laboral', '1-5 09:00-18:30; 6 09:00-13:00',
    'Horario por día (1 = lunes … 7 = domingo). Lo trabajado fuera de este horario cuenta como sobretiempo'],
  ['coordinador_puede_aprobar', 'SI', 'SI o NO: la coordinación puede aprobar tareas'],
  ['areas', 'Audiovisual,Diseño gráfico,Social Media,Community Manager,Trafficker,Dirección',
    'Áreas del equipo, separadas por coma'],
  ['marcas', 'Nexo,Academia VH Business,Vyc,Pagape,Marca Personal,EDE', 'Empresas o marcas, separadas por coma'],
  ['funciones', 'Diseño,Audiovisual,Community Management,Pauta,Producción de eventos,Contenido,Otros',
    'Tipos de trabajo para tareas, solicitudes y registro de horas'],
  ['funciones_evento', 'Audiovisual,CM,Fotografía,Producción,Apoyo', 'Funciones del personal en un evento'],
  ['tipos_agenda', 'Publicación,Grabación,Entregable,Lanzamiento,Fecha importante,Reunión,Otro',
    'Tipos de elementos de la agenda de contenido'],
  ['max_tareas_abiertas', '8', 'Más tareas abiertas que esto por persona genera alerta de sobrecarga'],
  ['feriados', '2026-10-08,2026-11-01,2026-12-08,2026-12-09,2026-12-25,2027-01-01,2027-03-25,2027-03-26,' +
    '2027-05-01,2027-06-07,2027-06-29,2027-07-23,2027-07-28,2027-07-29,2027-08-06,2027-08-30,2027-10-08,' +
    '2027-11-01,2027-12-08,2027-12-09,2027-12-25', 'Feriados (yyyy-MM-dd) separados por coma'],
  ['moneda', 'S/', 'Símbolo de soles'],
  ['marcas_en_soles', 'Nexo', 'Marcas cuya cuenta publicitaria está en soles (PEN); las demás se muestran en dólares ($) si la hoja no lo indica'],
  ['umbral_variacion', '30', 'Variación (%) de pauta semana contra semana que genera alerta'],
  ['excluidos_eventos', 'Chris,Cesi', 'Personas que no cubren eventos (home office): no salen en la rotación'],
  ['excluidos_horas', 'Chris,Cesi', 'Personas que no marcan horas (home office)'],
  ['gestion_alquiler', 'Jefferson', 'Quiénes (además del admin) ven y editan el alquiler de equipos de los eventos'],
  ['equipos_alquiler', 'Cámara,Lente,Memoria,Transmisor,PTZ,Batería,Trípode,Estabilizador,Micrófono,Iluminación,Drone,Otro',
    'Tipos de equipo que se pueden alquilar para un evento'],
  ['categorias_logistica', 'Audiovisuales,Materiales,Branding,Merchandising,Tecnología,Mobiliario,Alimentos y bebidas,Otro',
    'Categorías para la lista de logística de eventos'],
  ['horas_semana_practicante', '25', 'Horas semanales de los practicantes; lo que pase de esto es sobretiempo'],
  ['tipos_agenda_personal', 'Reunión,Recordatorio,Pendiente personal,Cita,Otro', 'Tipos de la agenda personal de cada persona'],
  ['hoja_requerimientos', 'https://docs.google.com/spreadsheets/d/1aRccmzKT2oMAkqdoGbSPsnxARFnnWl3rMO-AIqIq9jo/edit',
    'Google Sheet de requerimientos de diseño: cada cambio genera una notificación'],
  ['notif_requerimientos_todos', 'Gabriela', 'Quiénes reciben TODAS las notificaciones de requerimientos'],
  ['notif_requerimientos_reglas', 'Nexo,V&C,Vyc:Blue; Academia VHB,Marca Personal,Ede 2.0,VH CONSULTING:Chris',
    'Pestañas:persona que además recibe esos avisos (reglas separadas por punto y coma)']
];

// Equipo actual (octubre 2026). La migración 2 lo deja así y desactiva a quienes ya no están.
const EQUIPO_ACTUAL = [
  ['Rodrigo', 'colaborador', 'Audiovisual'],
  ['Jefferson', 'coordinador', 'Audiovisual'],
  ['Gabriela', 'coordinador', 'Social Media'],
  ['Blue', 'colaborador', 'Diseño gráfico'],
  ['Antony', 'colaborador', 'Audiovisual'],
  ['Renzo', 'practicante', 'Audiovisual'],
  ['Abigail', 'practicante', 'Audiovisual'],
  ['Chris', 'colaborador', 'Diseño gráfico'],
  ['Cesi', 'colaborador', 'Trafficker']
];
const YA_NO_ESTAN = ['fran', 'jorge', 'challs', 'henz'];

function setup() {
  const props = PropertiesService.getScriptProperties();
  const yaExistia = !!props.getProperty('DB_ID');
  const ss = yaExistia
    ? SpreadsheetApp.openById(props.getProperty('DB_ID'))
    : SpreadsheetApp.create('MarketingVH · Datos');
  if (!yaExistia) props.setProperty('DB_ID', ss.getId());
  if (!props.getProperty('SALT')) props.setProperty('SALT', uuid_() + uuid_());

  // Migración 2: Pauta_diaria cambió de estructura (antes venía de la API de Meta, ahora de Google Sheets).
  const pautaVieja = ss.getSheetByName('Pauta_diaria');
  if (pautaVieja && pautaVieja.getLastRow() > 0 && pautaVieja.getRange(1, 1).getValue() === 'fecha') ss.deleteSheet(pautaVieja);

  Object.keys(ESQUEMA).forEach(nombre => prepararHoja_(ss, nombre));
  if (!yaExistia) {
    ss.getSheets().filter(sh => !ESQUEMA[sh.getName()]).forEach(sh => ss.deleteSheet(sh));
  }

  const correoDueno = Session.getEffectiveUser().getEmail();
  let pinAdmin = null;
  conLock_(() => {
    const existentes = leerTabla_('Config').map(r => r.clave);
    CONFIG_INICIAL.concat([['correos_reporte', correoDueno, 'Correos que reciben reportes y alertas, separados por coma']])
      .filter(c => existentes.indexOf(c[0]) < 0)
      .forEach(c => agregarFila_('Config', { clave: c[0], valor: c[1], descripcion: c[2] }));

    if (leerTabla_('Usuarios').length === 0) {
      const admin = {
        id: uuid_(), nombre: 'Administrador', correo: correoDueno, rol: 'admin',
        area: 'Dirección', jornada_horas: '8', activo: 'SI', creado: ahora_()
      };
      pinAdmin = generarPin_();
      admin.pin_hash = hashPin_(admin.id, pinAdmin);
      agregarFila_('Usuarios', admin);
      log_(admin.id, 'setup', admin.id, 'Creación del administrador');
    }
  });
  invalidar_('config');
  invalidar_('usuarios');
  if (Number(props.getProperty('MIGRACION') || 0) < 2) {
    migracion2_();
    props.setProperty('MIGRACION', '2');
    console.log('Migración 2 aplicada: equipo actual, marcas, horario, redes sociales.');
  }
  if (Number(props.getProperty('MIGRACION') || 0) < 3) {
    migracion3_();
    props.setProperty('MIGRACION', '3');
    console.log('Migración 3 aplicada: fuente de pauta CA-Huacachina del Norte (Nexo).');
  }
  if (Number(props.getProperty('MIGRACION') || 0) < 4) {
    // Los montos ya no se convierten entre monedas: se quitan las claves de tipo de cambio.
    conLock_(() => {
      const quitar = ['moneda_informe', 'tipo_cambio_usd', 'tipo_cambio_mensual'];
      const cfg = leerTabla_('Config');
      if (cfg.some(c => quitar.indexOf(c.clave) >= 0)) reescribirTabla_('Config', cfg.filter(c => quitar.indexOf(c.clave) < 0));
    });
    invalidar_('config');
    props.setProperty('MIGRACION', '4');
  }

  console.log('Archivo de datos: ' + ss.getUrl());
  if (pinAdmin) {
    console.log('ADMINISTRADOR → correo: ' + correoDueno + ' · PIN inicial: ' + pinAdmin);
    console.log('Cámbialo desde «Mi cuenta» al ingresar por primera vez.');
  } else {
    console.log('Hojas y configuración actualizadas. El PIN del administrador no se cambió.');
  }
}

/**
 * Octubre 2026: equipo actual, marcas nuevas, sin importación del Excel ni Meta Ads,
 * y cuentas de redes sociales iniciales.
 */
function migracion2_() {
  const norm = s => normal_(s).split(' ')[0];
  conLock_(() => {
    // Config: valores nuevos y claves que ya no se usan.
    const cfg = leerTabla_('Config');
    const fijar = { marcas: 'Nexo,Academia VH Business,Vyc,Pagape,Marca Personal,EDE',
      areas: 'Audiovisual,Diseño gráfico,Social Media,Community Manager,Trafficker,Dirección' };
    const quitar = ['meta_cuentas', 'meta_api_version', 'dias_laborables'];
    const feriados = CONFIG_INICIAL.find(c => c[0] === 'feriados')[1];
    reescribirTabla_('Config', cfg.filter(c => quitar.indexOf(c.clave) < 0).map(c => {
      if (fijar[c.clave]) c.valor = fijar[c.clave];
      if (c.clave === 'feriados' && !c.valor) c.valor = feriados;
      return c;
    }));

    // «Academia» pasa a llamarse «Academia VH Business».
    const renombrar = (tabla, campo) => {
      const filas = leerTabla_(tabla);
      if (filas.some(r => r[campo] === 'Academia')) {
        reescribirTabla_(tabla, filas.map(r => { if (r[campo] === 'Academia') r[campo] = 'Academia VH Business'; return r; }));
      }
    };
    [['Tareas', 'marca'], ['Solicitudes', 'marca'], ['Horas', 'marca'], ['Agenda', 'marca'], ['Parrillas', 'marca'], ['Eventos', 'empresa']]
      .forEach(x => renombrar(x[0], x[1]));

    // Se descarta la importación del Excel de rotación, si se llegó a ejecutar.
    const eventos = leerTabla_('Eventos');
    const importados = eventos.filter(e => e.creado_por === 'importacion').map(e => e.id);
    if (importados.length) {
      reescribirTabla_('Eventos', eventos.filter(e => importados.indexOf(e.id) < 0));
      reescribirTabla_('Cobertura', leerTabla_('Cobertura').filter(c => importados.indexOf(c.evento_id) < 0));
    }

    // Equipo actual: se actualiza a quien ya existe (por primer nombre) y se crea a quien falta.
    const usuarios = leerTabla_('Usuarios');
    const nuevos = [];
    EQUIPO_ACTUAL.forEach(([nombre, rol, area]) => {
      const u = usuarios.find(x => norm(x.nombre) === norm(nombre) || (norm(nombre) === 'antony' && norm(x.nombre) === 'anthony'));
      if (u) {
        Object.assign(u, { nombre: u.nombre === 'Anthony' ? 'Antony' : u.nombre, rol: rol, area: area, activo: 'SI' });
        escribirFila_('Usuarios', u);
      } else {
        nuevos.push({ id: uuid_(), nombre: nombre, correo: '', rol: rol, area: area, pin_hash: '',
          jornada_horas: '8', activo: 'SI', creado: ahora_() });
      }
    });
    usuarios.filter(x => YA_NO_ESTAN.indexOf(norm(x.nombre)) >= 0 && x.activo === 'SI').forEach(x => {
      x.activo = 'NO';
      escribirFila_('Usuarios', x);
    });
    agregarFilas_('Usuarios', nuevos);

    // Cuentas de redes sociales.
    if (!leerTabla_('Redes_cuentas').length) {
      agregarFilas_('Redes_cuentas', CUENTAS_REDES_INICIALES.map(c => ({ id: uuid_(), marca: c[0], red: c[1], usuario: c[2], url: c[3], activo: 'SI' })));
    }
    log_('sistema', 'migracion', '2', 'Equipo actual, marcas, redes; ' + importados.length + ' eventos importados descartados');
  });
  invalidar_('config');
  invalidar_('usuarios');
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'pautaDiaria').forEach(t => ScriptApp.deleteTrigger(t));
}

/** Primera fuente de pauta: reporte diario de Meta Ads de CA-Huacachina del Norte (cuenta de Nexo, en soles). */
function migracion3_() {
  const url = 'https://docs.google.com/spreadsheets/d/1B4LrnDae5aEynziX17fw7EBnO2gVMRHcyUbZXyElVrc/edit';
  conLock_(() => {
    if (leerTabla_('Fuentes_pauta').some(f => idDeUrl_(f.url) === idDeUrl_(url))) return;
    agregarFila_('Fuentes_pauta', { id: uuid_(), marca: 'Nexo', nombre: 'Meta Ads · CA-Huacachina del Norte', url: url,
      hoja: 'Diario', activo: 'SI', creado: ahora_(), ultima_sync: '', estado_sync: '', filas: '0', moneda: 'PEN' });
    log_('sistema', 'migracion', '3', 'Fuente de pauta CA-Huacachina del Norte');
  });
  try { sincronizarPauta_(); } catch (e) { console.log('No se pudo leer la fuente todavía: ' + e.message); }
}

/** Crea la hoja si falta, o agrega al final las columnas nuevas del ESQUEMA. */
function prepararHoja_(ss, nombre) {
  const cab = ESQUEMA[nombre];
  let sh = ss.getSheetByName(nombre);
  if (!sh) sh = ss.insertSheet(nombre);

  if (sh.getLastRow() === 0) {
    if (sh.getMaxColumns() < cab.length) sh.insertColumnsAfter(sh.getMaxColumns(), cab.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, cab.length).setValues([cab])
      .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cab.length).setNumberFormat('@');
    if (sh.getMaxColumns() > cab.length) sh.deleteColumns(cab.length + 1, sh.getMaxColumns() - cab.length);
    return;
  }

  const actual = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String).filter(String);
  actual.forEach((c, i) => {
    if (cab[i] !== c) throw new Error('La hoja ' + nombre + ' tiene columnas en otro orden (' + c + '). Revísala antes de continuar.');
  });
  if (actual.length < cab.length) {
    const faltan = cab.length - actual.length;
    if (sh.getMaxColumns() < cab.length) sh.insertColumnsAfter(sh.getMaxColumns(), cab.length - sh.getMaxColumns());
    sh.getRange(1, actual.length + 1, 1, faltan).setValues([cab.slice(actual.length)])
      .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.getRange(1, actual.length + 1, sh.getMaxRows(), faltan).setNumberFormat('@');
  }
}

/**
 * Programa las tareas automáticas (ejecutar una vez desde el editor):
 * - sincronizarFuentes: cada hora relee los Google Sheets de pauta y las parrillas
 * - alertasDiarias: todos los días a las 8 a. m. (correo con alertas del equipo)
 * - copiaSemanal: los domingos, copia de seguridad del archivo de datos en Drive
 */
function instalarAutomatizaciones() {
  const funciones = ['pautaDiaria', 'sincronizarFuentes', 'alertasDiarias', 'copiaSemanal', 'revisarRecordatorios', 'alEditarRequerimientos'];
  ScriptApp.getProjectTriggers()
    .filter(t => funciones.indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizarFuentes').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('alertasDiarias').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('copiaSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(23).create();
  ScriptApp.newTrigger('revisarRecordatorios').timeBased().everyMinutes(5).create();
  const hojaReq = idDeUrl_(config_().hoja_requerimientos || '');
  if (hojaReq) ScriptApp.newTrigger('alEditarRequerimientos').forSpreadsheet(hojaReq).onEdit().create();
  console.log('Automatizaciones instaladas: sincronizarFuentes (cada hora), alertasDiarias (8 a. m.), copiaSemanal (domingos), ' +
    'revisarRecordatorios (cada 5 min)' + (hojaReq ? ', alEditarRequerimientos (al editar la hoja de requerimientos).' : '.'));
}

function copiaSemanal() {
  const archivo = DriveApp.getFileById(db_().getId());
  archivo.makeCopy('Respaldo MarketingVH · ' + hoy_());
}

/** Emergencia: si el administrador olvidó su PIN, ejecutar esto desde el editor. */
function resetearPinAdmin() {
  const pin = generarPin_();
  conLock_(() => {
    const admin = leerTabla_('Usuarios').find(x => x.rol === 'admin' && x.activo === 'SI');
    if (!admin) throw new Error('No hay un administrador activo.');
    admin.pin_hash = hashPin_(admin.id, pin);
    escribirFila_('Usuarios', admin);
    log_(admin.id, 'resetear_pin_admin', admin.id, 'Desde el editor');
    console.log('Nuevo PIN para ' + admin.correo + ': ' + pin);
  });
  invalidar_('usuarios');
}
