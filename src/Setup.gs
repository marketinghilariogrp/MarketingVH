/**
 * Instalación. Ejecutar setup() UNA vez desde el editor de Apps Script.
 * Crea el archivo de datos, las hojas, la configuración y el usuario administrador.
 * Se puede volver a ejecutar sin perder datos: solo agrega lo que falta.
 */

function setup() {
  const props = PropertiesService.getScriptProperties();
  const yaExistia = !!props.getProperty('DB_ID');
  const ss = yaExistia
    ? SpreadsheetApp.openById(props.getProperty('DB_ID'))
    : SpreadsheetApp.create('MarketingVH · Datos');
  if (!yaExistia) props.setProperty('DB_ID', ss.getId());
  if (!props.getProperty('SALT')) props.setProperty('SALT', uuid_() + uuid_());

  Object.keys(ESQUEMA).forEach(nombre => {
    const sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    if (sh.getLastRow() > 0) return;
    const cab = ESQUEMA[nombre];
    sh.getRange(1, 1, 1, cab.length).setValues([cab])
      .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cab.length).setNumberFormat('@');
    if (sh.getMaxColumns() > cab.length) sh.deleteColumns(cab.length + 1, sh.getMaxColumns() - cab.length);
  });
  if (!yaExistia) {
    ss.getSheets().filter(sh => !ESQUEMA[sh.getName()]).forEach(sh => ss.deleteSheet(sh));
  }

  const correoDueno = Session.getEffectiveUser().getEmail();
  const configInicial = [
    ['peso_alta', '3', 'Peso de producción de una tarea de prioridad alta'],
    ['peso_media', '2', 'Peso de producción de una tarea de prioridad media'],
    ['peso_baja', '1', 'Peso de producción de una tarea de prioridad baja'],
    ['jornada_horas', '8', 'Horas de jornada por defecto'],
    ['coordinador_puede_aprobar', 'SI', 'SI o NO: la coordinación puede aprobar tareas'],
    ['areas', 'Audiovisual,Diseño gráfico,Community Manager,Social Media Manager,Trafficker,Dirección',
      'Áreas del equipo, separadas por coma'],
    ['feriados', '', 'Fechas yyyy-MM-dd separadas por coma'],
    ['correos_reporte', correoDueno, 'Correos que reciben los reportes automáticos, separados por coma']
  ];

  let pinAdmin = null;
  conLock_(() => {
    const existentes = leerTabla_('Config').map(r => r.clave);
    configInicial
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
    console.log('El administrador ya existía; no se cambió su PIN.');
  }
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
