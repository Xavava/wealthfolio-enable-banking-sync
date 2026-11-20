# Enable Banking Sync para Wealthfolio

Add-on de [Wealthfolio](https://wealthfolio.app) que importa **con un botón** los movimientos de
tus cuentas bancarias (Santander, BBVA, CaixaBank, ING, Sabadell, Bankinter, Openbank… y más de
2.000 bancos europeos) a través de [Enable Banking](https://enablebanking.com), un agregador
Open Banking regulado (PSD2).

- Acceso de **solo lectura**: autorizas el acceso en la web de tu banco; el add-on nunca ve tus
  claves del banco.
- **Sin duplicados**: cada movimiento lleva un identificador estable (`sourceRecordId`) y
  Wealthfolio salta los que ya importaste. Puedes pulsar el botón todas las veces que quieras.
- **Transferencias internas**: el dinero que mueves entre dos cuentas tuyas sincronizadas se
  registra como transferencia (`TRANSFER_OUT` / `TRANSFER_IN`), no como gasto e ingreso.
- Tus datos solo viajan entre tu equipo y `api.enablebanking.com`.

Requiere **Wealthfolio 3.13 o superior**.

## 1. Crea tu aplicación en Enable Banking (una sola vez)

Enable Banking es gratuito para uso personal con tus propias cuentas (modo «restringido»).

1. Crea una cuenta en [enablebanking.com](https://enablebanking.com) y entra en el panel de
   control → **Applications** → **Register new application**.
2. Elige el entorno **Production**, ponle un nombre y añade una **URL de redirección**, por
   ejemplo `https://localhost/callback`. No tiene que existir ningún servidor ahí: solo
   copiarás la dirección a la que te devuelve el banco.
3. Genera la clave en el navegador. Se descargará un archivo `xxxxxxxx-xxxx-….pem`: el nombre
   del archivo es el **ID de la aplicación** y su contenido es la **clave privada**. Guárdalo
   bien.
4. En la aplicación recién creada pulsa **Link accounts** y autoriza tus cuentas en cada banco.
   Así la aplicación pasa a «Active (restricted)»: solo podrá leer las cuentas que vincules.

## 2. Instala el add-on

En Wealthfolio, ve a **Ajustes → Add-ons**, elige instalar desde archivo y selecciona
`wealthfolio-enable-banking-sync-addon-1.0.0.zip`. Acepta los permisos:

| Permiso | Para qué |
| --- | --- |
| Cuentas (`getAll`) | Listar tus cuentas de Wealthfolio para asociarlas con las del banco |
| Actividades (`checkImport`, `import`) | Validar e importar los movimientos |
| Secretos | Guardar cifrada la clave privada y el token temporal de acceso |
| Red (`api.enablebanking.com`) | Hablar con Enable Banking |

Aparecerá **Sincronizar bancos** en la barra lateral.

## 3. Configura y conecta tus bancos

1. **Aplicación de Enable Banking**: pega el ID de la aplicación y carga el `.pem`. Pulsa
   *Guardar y comprobar*. La clave se guarda en el almacén de credenciales del sistema.
2. **Conectar un banco**: elige país y banco y pulsa *Generar enlace de autorización*.
   - Copia el enlace y ábrelo en tu navegador (los add-ons no pueden abrir el navegador).
   - Autoriza en tu banco. Te llevará a `https://localhost/callback?…&code=…`, una página que
     no carga. Es normal.
   - Copia esa URL completa de la barra de direcciones, pégala en el add-on y pulsa
     *Completar conexión*.
3. **Bancos conectados**: elige en qué cuenta de Wealthfolio entra cada cuenta bancaria.
   Conviene crear antes en Wealthfolio una cuenta de tipo *Efectivo* (o *Tarjeta de crédito*)
   por cada cuenta del banco. Elige también desde qué fecha importar la primera vez (por
   defecto, 90 días atrás).
4. Pulsa **Sincronizar ahora**. Verás cuántos movimientos se descargaron, cuántos eran nuevos
   y cuántos ya estaban.

Cuando caduque el consentimiento (normalmente entre 90 y 180 días, según el banco), pulsa
**Renovar** en ese banco y repite la autorización. Se conservan las asociaciones de cuentas y el
historial.

## Cómo se convierten los movimientos

| Movimiento del banco | Actividad en Wealthfolio |
| --- | --- |
| Cargo (`DBIT`) | `WITHDRAWAL` |
| Abono (`CRDT`) | `DEPOSIT` |
| Abono cuyo concepto contiene «intereses» (desactivable) | `INTEREST` |
| Cargo/abono hacia otra cuenta tuya sincronizada (mismo IBAN) | `TRANSFER_OUT` / `TRANSFER_IN` (internas) |
| Movimiento pendiente (`PDNG`) | No se importa hasta que el banco lo contabilice |

El comentario de cada actividad lleva la contraparte y el concepto (`MERCADONA · COMPRA TARJ.
1234`). Los detalles del banco (referencia, fechas de contabilización y valor, código de
operación) se guardan en los metadatos de la actividad.

En cada sincronización se vuelven a leer los 7 días anteriores a la última, para recoger
movimientos que el banco contabiliza tarde. Los ya importados se saltan solos.

## Limitaciones

- **Consultas al día**: por PSD2, algunos bancos limitan las consultas sin el usuario delante a
  unas 4 al día por cuenta. Si ves un error de límite, espera unas horas.
- **Histórico**: muchos bancos solo dan 90 días de movimientos (algo más justo después de
  autorizar).
- No importa saldos ni categorías: usa las reglas de categorización de gastos de Wealthfolio.
- Es necesario copiar y pegar la URL de vuelta del banco, porque los add-ons se ejecutan en un
  sandbox sin acceso al navegador.

## Desarrollo

```bash
pnpm install
pnpm test          # pruebas unitarias y de extremo a extremo contra una API simulada
pnpm type-check
pnpm dev:server    # con Wealthfolio en modo desarrollo de add-ons
pnpm bundle        # genera dist/wealthfolio-enable-banking-sync-addon-<versión>.zip
```

Estructura:

- `src/lib/jwt.ts`: firma RS256 del JWT de Enable Banking con WebCrypto (claves PKCS#8 y PKCS#1).
- `src/lib/enable-banking-client.ts`: cliente de la API. El broker de red de Wealthfolio no
  permite la cabecera `Authorization`, así que el JWT se guarda como secreto (`api-jwt`) y se
  envía con `auth.secretKey`.
- `src/lib/connect.ts`: autorización del banco (`/auth` → `/sessions`) y renovación.
- `src/lib/mapping.ts`: conversión de movimientos a `ActivityImport`.
- `src/lib/sync.ts`: descarga, `checkImport` y `import`.
- `src/components`, `src/pages`: interfaz.
