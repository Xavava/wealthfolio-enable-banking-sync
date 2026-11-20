# Changelog

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
