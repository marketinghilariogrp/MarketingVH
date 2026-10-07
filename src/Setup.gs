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
  ['dias_laborables', '1,2,3,4,5', 'Días laborables para calcular capacidad (1 = lunes … 7 = domingo)'],
  ['coordinador_puede_aprobar', 'SI', 'SI o NO: la coordinación puede aprobar tareas'],
  ['areas', 'Audiovisual,Diseño gráfico,Community Manager,Social Media Manager,Trafficker,Dirección',
    'Áreas del equipo, separadas por coma'],
  ['marcas', 'Academia,Nexo,Vyc,Marca Personal,EDE', 'Empresas o marcas, separadas por coma'],
  ['funciones', 'Diseño,Audiovisual,Community Management,Pauta,Producción de eventos,Contenido,Otros',
    'Tipos de trabajo para tareas, solicitudes y registro de horas'],
  ['funciones_evento', 'Audiovisual,CM,Fotografía,Producción,Apoyo', 'Funciones del personal en un evento'],
  ['tipos_agenda', 'Publicación,Grabación,Entregable,Lanzamiento,Fecha importante,Reunión,Otro',
    'Tipos de elementos de la agenda de contenido'],
  ['max_tareas_abiertas', '8', 'Más tareas abiertas que esto por persona genera alerta de sobrecarga'],
  ['feriados', '', 'Fechas yyyy-MM-dd separadas por coma'],
  ['meta_cuentas', '615089831325651:CA-Huacachina del Norte;745987248309855:El despertar del emprendedor;' +
    '4362857017376427:Marca Personal Vitmer;149663071348835:VH Business Academy 2025',
    'Cuentas publicitarias de Meta: id:Nombre separadas por punto y coma'],
  ['meta_api_version', 'v24.0', 'Versión de la API de Meta (Graph API)'],
  ['moneda', 'S/', 'Símbolo de moneda de las cuentas publicitarias'],
  ['umbral_variacion', '30', 'Variación (%) de pauta vs. promedio de 7 días que genera alerta']
];

function setup() {
  const props = PropertiesService.getScriptProperties();
  const yaExistia = !!props.getProperty('DB_ID');
  const ss = yaExistia
    ? SpreadsheetApp.openById(props.getProperty('DB_ID'))
    : SpreadsheetApp.create('MarketingVH · Datos');
  if (!yaExistia) props.setProperty('DB_ID', ss.getId());
  if (!props.getProperty('SALT')) props.setProperty('SALT', uuid_() + uuid_());

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

  console.log('Archivo de datos: ' + ss.getUrl());
  if (pinAdmin) {
    console.log('ADMINISTRADOR → correo: ' + correoDueno + ' · PIN inicial: ' + pinAdmin);
    console.log('Cámbialo desde «Mi cuenta» al ingresar por primera vez.');
  } else {
    console.log('Hojas y configuración actualizadas. El PIN del administrador no se cambió.');
  }
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
 * - pautaDiaria: todos los días entre 6:00 y 6:15 p. m. (corte de Meta Ads + correo)
 * - alertasDiarias: todos los días a las 8 a. m. (correo con alertas del equipo)
 * - copiaSemanal: los domingos, copia de seguridad del archivo de datos en Drive
 */
function instalarAutomatizaciones() {
  const funciones = ['pautaDiaria', 'alertasDiarias', 'copiaSemanal'];
  ScriptApp.getProjectTriggers()
    .filter(t => funciones.indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('pautaDiaria').timeBased().everyDays(1).atHour(18).nearMinute(0).create();
  ScriptApp.newTrigger('alertasDiarias').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('copiaSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(23).create();
  console.log('Automatizaciones instaladas: ' + funciones.join(', '));
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
