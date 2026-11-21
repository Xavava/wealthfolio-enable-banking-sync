# Changelog

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
