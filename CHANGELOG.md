# Changelog

## [1.8.2] - 2026-11-26

### Fixed

- El saldo del banco se lee en la primera sincronización del día. Si otra sincronización ese día
  importaba movimientos, Wealthfolio los sumaba y la comparación mostraba un descuadre falso por
  ese importe hasta el día siguiente. Ahora el add-on recuerda que el saldo del banco es anterior
  a esos movimientos y en lugar del descuadre muestra «Saldo del banco anterior a los últimos
  movimientos». Este aviso no cuenta como cuenta por revisar ni despliega la tarjeta.
- Mientras haya algún saldo así, junto a *Sincronizar ahora* aparece **Actualizar saldos**, que
  vuelve a leer el saldo solo de esas cuentas (una consulta por cuenta). Si no se pulsa, el saldo
  se lee en la primera sincronización del día siguiente.
- No hay permisos ni hosts nuevos.

## [1.8.1] - 2026-11-26

### Changed

- Los movimientos que el banco contabiliza sin el nombre del comercio, ordenante o beneficiario se
  siguen importando enseguida con el concepto del banco, y ahora el add-on espera 14 días a que
  llegue el nombre: si una sincronización de ese plazo lo recibe, reescribe la nota con lo que
  mande entonces el banco, con el nombre delante como el resto. Por ejemplo, BBVA manda «PAGO CON
  TARJETA EN SUPERMERCADOS» y añade el comercio días después, y una nómina leída el mismo día llega
  sin el ordenante y con el concepto cortado. Los traspasos entre tus cuentas (como los redondeos)
  no esperan: nunca traen nombre.
- Mientras alguno espera, cada sincronización vuelve a leer desde su fecha. Para ello el add-on
  guarda una lista corta de esos movimientos (fecha, tipo, moneda e importe) durante esos 14 días.
  Solo cambia la nota de los movimientos que importó él: si en esos días editas la nota de uno, el
  add-on la sobrescribe.
- El informe dice cuántos movimientos esperan el nombre, cuántas notas se han actualizado y cuáles
  se quedan sin él al acabar el plazo. Si Wealthfolio rechaza el cambio de una nota, se reintenta
  y, pasados 30 días, se deja de intentar con un aviso.
- Nuevo permiso `activities.update`, solo para reescribir esa nota. No hay hosts nuevos.
- Se pasa de la 1.5.2 a la 1.8.1 porque las versiones intermedias fueron pruebas personales que no
  se publicaron.

## [1.5.2] - 2026-11-26

### Changed

- Todo lo que pasa con cada cuenta se ve en un solo sitio, la tarjeta *Sincronización*: una fila
  por cuenta sincronizada con los números de la última sincronización, sus avisos, la última
  sincronización correcta y desde cuándo se vuelve a revisar, el historial que dio el banco y la
  comprobación de saldo. Las cuentas recién asociadas aparecen aunque aún no se hayan
  sincronizado, con lo que les falta.
- *Bancos conectados* queda solo para configurar (consentimiento, renovar o desconectar, cuenta de
  destino y fecha de inicio) y cada cuenta se identifica por su IBAN abreviado en lugar del
  nombre del titular.
- Las tarjetas se pliegan desde su título y el add-on recuerda cómo las dejaste. Plegadas
  muestran una línea de resumen y «Sincronizar ahora» sigue a mano. Una tarjeta plegada se
  despliega sola cuando necesita atención (un error o un descuadre en la sincronización, un
  consentimiento caducado o que caduca en 7 días, una fecha de inicio por elegir, una
  autorización a medias) y *Sincronización* se despliega siempre al sincronizar.
- El informe guarda a qué cuenta pertenece cada fila. Los de la 1.5.0 y la 1.5.1 se asocian por el
  IBAN abreviado; los anteriores se muestran aparte hasta la siguiente sincronización.

## [1.5.1] - 2026-11-23

### Changed

- La página ocupa todo el ancho de la ventana, como las de Wealthfolio, en lugar de quedarse en
  unos 900 píxeles centrados. La tabla del informe cabe entera y los mensajes de cada cuenta usan
  el ancho de su columna.
- Los errores de Enable Banking muestran su mensaje una sola vez: la API lo repite dentro del
  detalle y antes salía dos veces.

## [1.5.0] - 2026-11-21

### Changed

- El informe de sincronización identifica cada fila por su cuenta de Wealthfolio, con el banco y
  el IBAN abreviado debajo (por ejemplo «Cuenta corriente» / «BBVA · ES91 •••• 1332»), en
  lugar del nombre que da el banco, que suele ser el del titular y se repite en todas. Los
  mensajes de progreso y la lista de movimientos rechazados usan también la cuenta de Wealthfolio.
  El informe guardado antes se sigue viendo como antes hasta la siguiente sincronización.

## [1.4.0] - 2026-11-21

### Added

- Interfaz en inglés además de en español: sigue el idioma de Wealthfolio, y cualquier idioma sin
  traducción se muestra en inglés. Los mensajes de la sincronización también se traducen, incluido
  el último informe guardado.
- Fechas e importes con el formato regional que tengas en Wealthfolio, en lugar de fijo en español.
- README en inglés (`README.md`) y en español (`README.es.md`), licencia MIT (`LICENSE`) y avisos
  de marcas y de seguridad.

### Changed

- Nuevo nombre: «Enable Banking Sync for Wealthfolio», para que no parezca un add-on oficial de
  Wealthfolio ni de Enable Banking. El identificador no cambia: se actualiza sin perder datos.
- La descripción, la entrada de la barra lateral («Bank sync») y la explicación de los permisos
  del manifest están en inglés: Wealthfolio solo admite un idioma para ellos.
- El aviso de que el banco no compartió ninguna cuenta explica que hay que vincular en Enable
  Banking cada cuenta que se quiera usar.

## [1.3.0] - 2026-11-20

### Changed

- La primera sincronización de cada cuenta, y cualquiera que empiece hace más de 90 días, pide a
  Enable Banking el historial más largo que conserve el banco desde la fecha de inicio
  (`strategy=longest`). El informe y «Bancos conectados» dicen desde qué fecha dio movimientos.

### Fixed

- Si se pedía más historial del que guarda el banco, BBVA devolvía una lista vacía y la cuenta
  se daba por sincronizada: las siguientes sincronizaciones empezaban una semana atrás y el
  historial intermedio se perdía sin aviso. Ahora entra lo que el banco tenga y, si no devuelve
  nada, la cuenta no se da por sincronizada.

## [1.2.4] - 2026-11-20

### Changed

- Cuando Wealthfolio no deja salir una petición (lo habitual: instalar o actualizar el add-on
  sin marcar `api.enablebanking.com` en «Hosts de red»), el add-on lo dice y explica cómo
  aprobarlo, en lugar de mostrar «No se pudo completar la operación». En la sincronización se
  avisa una vez y no se insiste con el resto de cuentas.
- README: la casilla de «Hosts de red» hay que marcarla al instalar y al actualizar.

## [1.2.3] - 2026-11-20

### Fixed

- Ningún movimiento llegaba a Wealthfolio: la sincronización fallaba con «No se pudo completar
  la operación». Wealthfolio exige el campo `symbol` en cada fila (vacío para movimientos de
  efectivo), aunque el tipo del SDK lo marca como opcional, y el add-on no lo enviaba.
- Si Wealthfolio rechaza la validación entera, el error aparece en el informe con su código y
  se conservan los saldos leídos, en lugar de abortar la sincronización con un mensaje genérico.

## [1.2.2] - 2026-11-20

### Fixed

- No se podía escribir el año en «Importar desde»: el campo se guardaba y se redibujaba con cada
  tecla y el año quedaba como 0026. Ahora solo se guardan fechas completas y válidas (desde el
  01/01/2000 y no futuras) y se avisa si no lo son. Una fecha imposible guardada antes bloquea
  esa cuenta con un aviso en lugar de sincronizar.
- La columna de la fecha se ensanchaba con el texto de ayuda: usaba una clase de estilo
  (`sm:w-48`) que Wealthfolio no incluye. Revisadas todas las clases del add-on.

## [1.2.1] - 2026-11-20

### Changed

- Textos: el add-on se describe como sincronización PSD2 mediante Enable Banking.

## [1.2.0] - 2026-11-20

### Changed

- Quitado el permiso `activities.search`: el add-on ya no lee los movimientos que tienes en
  Wealthfolio (era el permiso de lectura más amplio y solo servía para la primera
  sincronización). Ahora eliges tú la fecha de inicio de cada cuenta: no hay fecha por defecto
  y, hasta que la elijas, esa cuenta no se sincroniza. Quedan 10 funciones declaradas.

### Fixed

- Al renovar el consentimiento del banco se perdían los movimientos retenidos (pendientes o
  rechazados), la fecha de inicio elegida y el último saldo leído.

## [1.1.0] - 2026-11-20

### Fixed

- Los movimientos que Wealthfolio rechazaba se perdían si eran de más de 7 días antes: ahora la
  siguiente sincronización vuelve a leer desde su fecha hasta que entran.
- Lo mismo con los pendientes que el banco contabiliza más de 7 días después.
- Las filas que la importación descartaba como no válidas se contaban como importadas.
- La primera sincronización de una cuenta que ya tenía movimientos de un CSV podía duplicarlos
  (Wealthfolio solo los reconoce si coincide también el comentario). Ahora se propone empezar el
  día siguiente al último y, si la fecha se solapa, la cuenta se bloquea con un aviso.
- Requiere Wealthfolio 3.13.1: en Windows, la 3.13.0 admite unos 1.280 caracteres por secreto
  y no puede guardar la clave privada RSA (ocupa unos 1.700 o más).

### Added

- Traspasos entre tus cuentas sin IBAN (pago de tarjeta, recargas, «traspaso»), desactivable.
- Saldo del banco (como mucho una lectura al día) comparado con el de Wealthfolio.
- Script de empaquetado multiplataforma (`scripts/package.mjs`).

## [1.0.0] - 2026-11-20

### Added

- Configuración de la aplicación de Enable Banking (ID + clave privada `.pem`, guardada como secreto).
- Conexión de bancos vía PSD2 (`/auth` → `/sessions`) con renovación del consentimiento que conserva las asociaciones.
- Asociación de cada cuenta bancaria con una cuenta de Wealthfolio y fecha inicial de importación.
- Botón «Sincronizar ahora»: descarga los movimientos contabilizados, los valida con `checkImport` e importa solo los nuevos (`sourceRecordId`).
- Detección de transferencias entre cuentas propias e intereses.
