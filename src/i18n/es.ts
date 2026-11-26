/**
 * Textos en español: el idioma de trabajo del add-on. Los textos nuevos se
 * escriben aquí primero y después se traducen en `en.ts`, que debe tener las
 * mismas claves (Wealthfolio usa el inglés para cualquier idioma sin traducción).
 *
 * Marcadores: `{{nombre}}` se sustituye al mostrar el texto. En los mensajes de
 * la sincronización, un marcador que acaba en `Date` es una fecha y se muestra
 * en el formato del usuario.
 */
export const es = {
  page: {
    heading: 'Sincronizar bancos',
    text: 'Importa con un botón los movimientos de tus cuentas bancarias mediante Enable Banking (PSD2).',
  },
  common: {
    copy: 'Copiar',
    copied: 'Copiado',
    copyManual: 'No se pudo copiar automáticamente: haz clic en el campo y pulsa Ctrl+C (⌘+C en Mac).',
    cancel: 'Cancelar',
  },
  settings: {
    title: 'Aplicación de Enable Banking',
    configured: 'Configurada',
    description:
      'Crea una aplicación en el panel de Enable Banking (entorno {{environment}}), vincula con «Link accounts» cada cuenta que quieras sincronizar y añade aquí su ID y la clave privada que descargaste.',
    appIdLabel: 'ID de aplicación:',
    checking: 'Comprobando credenciales…',
    unknownEnvironment: 'entorno desconocido',
    inactive: 'inactiva',
    validateFailed: 'No se pudo validar la aplicación',
    noRedirectTitle: 'Sin URL de redirección',
    noRedirect:
      'Añade una URL de redirección a la aplicación en el panel de Enable Banking (por ejemplo https://localhost/callback) para poder autorizar bancos.',
    change: 'Cambiar credenciales',
    deleteKey: 'Borrar clave privada',
    appIdField: 'ID de la aplicación',
    appIdHint: 'Es el nombre del archivo .pem sin la extensión.',
    keyField: 'Clave privada (.pem)',
    keyHintSaved: 'Ya hay una clave guardada. Déjalo vacío para conservarla.',
    keyHintNew: 'Se guarda cifrada en el almacén de credenciales del sistema; nunca sale de tu equipo.',
    needAppId: 'Introduce el ID de la aplicación.',
    needKey: 'Añade la clave privada (.pem).',
    save: 'Guardar y comprobar',
    connectedToast: 'Conectado a Enable Banking: {{name}}',
  },
  connect: {
    titleNew: 'Conectar un banco',
    titleRenew: 'Renovar {{bank}}',
    description:
      'Autoriza el acceso de solo lectura a tus cuentas en la web de tu banco (PSD2). El acceso caduca pasado el plazo del consentimiento y habrá que renovarlo.',
    country: 'País',
    search: 'Buscar banco',
    searchPlaceholder: 'Santander, BBVA, ING…',
    bank: 'Banco',
    loadingBanks: 'Cargando bancos…',
    consentDays: 'Duración del consentimiento (días)',
    consentMax: 'Máximo para este banco: {{n}} días.',
    redirect: 'URL de redirección',
    redirectHint: 'Debe estar registrada en tu aplicación de Enable Banking.',
    generate: 'Generar enlace de autorización',
    step1: 'Copia este enlace y ábrelo en tu navegador para autorizar {{bank}}:',
    step2:
      'Al terminar, el banco te llevará a {{url}}. Es normal que esa página no cargue: copia la URL completa de la barra de direcciones (contiene {{code}}).',
    step3: 'Pégala aquí:',
    complete: 'Completar conexión',
    connectedToast: '{{bank}}: {{n}} cuenta(s) conectada(s)',
  },
  connections: {
    title: 'Bancos conectados',
    description:
      'Elige en qué cuenta de Wealthfolio entra cada cuenta del banco. Las cuentas en «{{none}}» se ignoran.',
    noAccounts:
      'No tienes cuentas de Wealthfolio en modo transacciones. Crea una cuenta de tipo efectivo (o tarjeta) en Wealthfolio y vuelve aquí.',
    confirmDisconnect: '¿Desconectar? Lo ya importado se conserva.',
    yesDisconnect: 'Sí, desconectar',
    renew: 'Renovar',
    disconnect: 'Desconectar',
    disconnectedToast: '{{bank}} desconectado',
    consentExpired: 'Consentimiento caducado',
    expiresIn: 'Caduca en {{n}} día(s)',
    validUntil: 'Válido hasta el {{date}}',
    typeCash: 'efectivo',
    typeCard: 'tarjeta',
    typeSecurities: 'inversión',
    typeCrypto: 'cripto',
    startDateLabel: 'Importar movimientos desde',
    invalidDate: 'Fecha no válida: tiene que ser posterior al {{min}} y no futura.',
    targetLabel: 'Cuenta de Wealthfolio para {{account}}',
    noSync: 'No sincronizar',
    currencyMismatch: 'La cuenta del banco está en {{bankCurrency}} y la de Wealthfolio en {{wealthfolioCurrency}}.',
    duplicateTarget: 'Otra cuenta bancaria también se sincroniza con esta cuenta de Wealthfolio.',
    retryFrom: 'Se vuelve a revisar desde el {{date}}',
    importFrom: 'Importar desde',
    importsFrom: 'Importa desde el {{date}}',
    chooseStart:
      'Elige el día siguiente al último movimiento que ya tengas en esta cuenta de Wealthfolio (por ejemplo, de un CSV) para no duplicarlo. Si está vacía, la fecha desde la que quieras historial.',
    historyHint:
      'Muchos bancos solo dan {{days}} días de historial, salvo en la hora siguiente a autorizar: sincroniza nada más conectar o renovar el banco.',
    historyGiven: 'Historial que dio el banco: desde el {{earliest}} (pedido desde el {{requested}}; {{checked}}).',
    historyNone: 'El banco no devolvió ningún movimiento desde el {{requested}} ({{checked}}).',
    balanceBank: 'Banco:',
    balanceWealthfolio: 'Wealthfolio:',
    balanceMatch: 'Cuadra',
    balanceMatchInverted: 'Cuadra (el banco lo muestra con el signo contrario)',
    balanceMismatch: 'Descuadre: {{difference}}',
    balanceMismatchHelp:
      'Puede haber movimientos duplicados con un CSV (fecha de inicio solapada), faltar historial anterior a la fecha de inicio, haber movimientos pendientes o rechazados, o Wealthfolio no haber terminado de recalcular.',
    balanceAvailableOnly: 'El banco solo da saldo disponible, que puede incluir crédito o retenciones.',
    balanceCurrencies: 'Divisas distintas: no se compara.',
    collapsedSummary: '{{banks}} banco(s) · {{accounts}} cuenta(s) sincronizada(s)',
  },
  syncCard: {
    title: 'Sincronización',
    syncNow: 'Sincronizar ahora',
    syncing: 'Sincronizando…',
    preparing: 'Preparando…',
    noMapped:
      'Conecta un banco y asigna al menos una de sus cuentas a una cuenta de Wealthfolio para poder sincronizar.',
    failedTitle: 'No se pudo sincronizar',
    lastSync: 'Última sincronización: {{when}}',
    lastGoodSync: 'Última sincronización correcta: {{when}}',
    collapsedSummary: 'Última: {{when}} · {{n}} nuevo(s)',
    toCheck: '{{n}} cuenta(s) por revisar',
    notSyncedYet: 'Todavía no se ha sincronizado.',
    needsStartDate: 'Elige desde qué fecha importar en «Bancos conectados».',
    newCount: '{{n}} nuevo(s)',
    duplicateCount: '{{n}} ya importado(s)',
    transferCount: '{{n}} traspaso(s) entre tus cuentas',
    errorCount: '{{n}} con errores',
    columnAccount: 'Cuenta',
    columnFrom: 'Desde',
    columnFetched: 'Descargados',
    columnNew: 'Nuevos',
    columnExisting: 'Ya estaban',
    columnStatus: 'Estado',
    statusOk: 'OK',
    statusReconnect: 'Renovar',
    statusBlocked: 'Revisar fecha',
    statusError: 'Error',
    invalidSummary: '{{n}} movimiento(s) que Wealthfolio no aceptó',
    toastIssues: 'Sincronización con incidencias: {{n}} movimiento(s) nuevo(s)',
    toastImported: '{{n}} movimiento(s) nuevo(s) importado(s)',
    toastUpToDate: 'Todo al día: no hay movimientos nuevos',
    optionInterest: 'Registrar como «Intereses» los ingresos cuyo concepto contenga «intereses»',
    optionTransfers:
      'Registrar como traspaso un cargo y un abono del mismo importe entre dos de tus cuentas sincronizadas (hasta 3 días de diferencia) cuando una es de tarjeta o el concepto dice «traspaso», «recarga» o «pago tarjeta»',
  },
  sync: {
    consentExpired: 'El consentimiento del banco ha caducado. Pulsa «Renovar» para volver a autorizarlo.',
    chooseStartDate:
      'Elige en «Bancos conectados» desde qué fecha importar esta cuenta: el día siguiente al último movimiento que ya tengas en esa cuenta de Wealthfolio (por ejemplo, de un CSV).',
    invalidStartDate:
      'La fecha de inicio ({{startDate}}) no es válida: tiene que ser posterior al {{minDate}} y no futura. Corrígela en «Bancos conectados».',
    futureStart: 'La fecha de inicio es posterior a hoy: todavía no hay nada que importar.',
    skippedNetwork: 'No se ha consultado: Wealthfolio no deja salir las peticiones (ver la primera cuenta con error).',
    progressDownload: 'Descargando movimientos de {{bank}} · {{account}} desde el {{fromDate}}…',
    progressValidate: 'Validando {{n}} movimiento(s) con Wealthfolio…',
    progressImport: 'Importando {{n}} movimiento(s) nuevo(s)…',
    noMovements: 'El banco no ha devuelto ningún movimiento desde el {{fromDate}}.',
    noMovementsFirstSync:
      'El banco no ha devuelto ningún movimiento desde el {{fromDate}}. La cuenta no se da por sincronizada. Si esperabas movimientos, el banco no guarda tanto historial o ya pasó la hora siguiente a autorizar: renueva el permiso y sincroniza enseguida, o elige una fecha más reciente. Si la cuenta no tuvo movimientos en ese tiempo, es normal.',
    historyPartial:
      'El banco ha dado movimientos desde el {{earliestDate}} (pediste desde el {{fromDate}}). Si en ese intervalo hubo movimientos, el banco no guarda más historial: compruébalo con el saldo.',
    historyFull: 'El banco ha dado todo el historial pedido, desde el {{earliestDate}}.',
    balanceFailed: 'No se pudo leer el saldo del banco: {{detail}}',
    invalidRow: 'Fila no válida',
    validateFailed: 'Wealthfolio no pudo validar los movimientos: {{detail}}',
    importRejected: 'Wealthfolio rechazó la importación.',
    importRejectedDetail: 'Wealthfolio rechazó la importación: {{detail}}',
    importFailed: 'Error al importar: {{detail}}',
    heldTooOld:
      'Hay movimientos pendientes o rechazados del {{holdDate}} que ya no se volverán a consultar (más de {{days}} días). Revísalos a mano.',
    pendingNote: '{{n}} movimiento(s) pendiente(s): se importarán cuando el banco los contabilice.',
    rejectedNote: '{{n}} movimiento(s) rechazado(s) por Wealthfolio: se volverán a intentar en la próxima sincronización.',
    ownTransfersNote: '{{n}} movimiento(s) registrado(s) como traspaso entre tus cuentas.',
    transferFrom: 'Transferencia desde',
    transferTo: 'Transferencia a',
  },
  errors: {
    unknown: 'Error desconocido',
    networkBlocked:
      'Wealthfolio no ha dejado salir la petición a api.enablebanking.com. Suele pasar al instalar o actualizar el add-on sin marcar el acceso a internet: ve a Ajustes → Complementos, pasa el ratón por {{addon}}, pulsa el icono del ojo («Ver permisos»), marca api.enablebanking.com en «Hosts de red» y pulsa Guardar. Si ya está marcado, comprueba tu conexión a internet.',
    networkBlockedDetail:
      'Wealthfolio no ha dejado salir la petición a api.enablebanking.com. Suele pasar al instalar o actualizar el add-on sin marcar el acceso a internet: ve a Ajustes → Complementos, pasa el ratón por {{addon}}, pulsa el icono del ojo («Ver permisos»), marca api.enablebanking.com en «Hosts de red» y pulsa Guardar. Si ya está marcado, comprueba tu conexión a internet. (Detalle: {{detail}})',
    apiUnauthorized:
      '{{detail}} Revisa el ID de aplicación y la clave privada; si son correctos, puede que el consentimiento del banco haya caducado.',
    apiRateLimited:
      '{{detail}} El banco limita el número de consultas diarias (PSD2 permite unas 4 consultas automáticas al día por cuenta). Inténtalo más tarde.',
    missingAppId: 'Falta el ID de la aplicación de Enable Banking.',
    missingKey: 'No hay clave privada guardada. Configura Enable Banking primero.',
    tooManyPages: 'Demasiadas páginas de movimientos (más de {{max}}). Reduce el rango de fechas.',
    bankError: 'El banco devolvió un error: {{detail}}. Vuelve a generar el enlace.',
    missingCode: 'No encuentro el parámetro "code" en lo que has pegado. Pega la URL completa.',
    stateMismatch: 'Esta URL no corresponde al último enlace generado. Genera uno nuevo y vuelve a autorizar.',
    noAccounts:
      'El banco no ha compartido ninguna cuenta. En modo restringido, vincula primero en el panel de Enable Banking («Link accounts») cada cuenta que quieras usar.',
    pemFormat: 'La clave privada no tiene formato PEM. Debe empezar por "-----BEGIN PRIVATE KEY-----".',
    pemEncrypted: 'La clave privada está cifrada con contraseña. Usa la clave sin cifrar (.pem).',
    keyType: 'Tipo de clave no soportado: "{{label}}". Se esperaba una clave privada RSA.',
    noWebCrypto: 'WebCrypto no está disponible en este entorno; no se puede firmar el token.',
    keyUnreadable: 'No se pudo leer la clave privada. Comprueba que es la clave RSA de tu aplicación.',
  },
};

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

/** Every translation must have exactly the keys of the Spanish texts. */
export type Translations = Shape<typeof es>;
