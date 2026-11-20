# Changelog

## [1.0.0] - 2026-11-20

### Added

- Configuración de la aplicación de Enable Banking (ID + clave privada `.pem`, guardada como secreto).
- Conexión de bancos vía PSD2 (`/auth` → `/sessions`) con renovación del consentimiento que conserva las asociaciones.
- Asociación de cada cuenta bancaria con una cuenta de Wealthfolio y fecha inicial de importación.
- Botón «Sincronizar ahora»: descarga los movimientos contabilizados, los valida con `checkImport` e importa solo los nuevos (`sourceRecordId`).
- Detección de transferencias entre cuentas propias e intereses.
