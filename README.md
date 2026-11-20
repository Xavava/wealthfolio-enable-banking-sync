# Enable Banking Sync para Wealthfolio

Add-on de [Wealthfolio](https://wealthfolio.app) que importa **con un botón** los movimientos de
tus cuentas bancarias (Santander, BBVA, CaixaBank, ING, Sabadell, Bankinter, Openbank… y más de
2.000 bancos europeos) a través de [Enable Banking](https://enablebanking.com), un agregador
Open Banking regulado (PSD2).

- Acceso de **solo lectura**: autorizas el acceso en la web de tu banco; el add-on nunca ve tus
  claves del banco.
- **Sin duplicados**: cada movimiento lleva un identificador estable (`sourceRecordId`) y
  Wealthfolio salta los que ya importaste. Puedes pulsar el botón todas las veces que quieras.
- **No pierde movimientos**: los pendientes y los que Wealthfolio rechaza se vuelven a consultar
  en cada sincronización hasta que entran.
- **Sin solapes con tus CSV**: en la primera sincronización de cada cuenta eliges tú desde qué
  fecha importar, y la comprobación de saldo avisa si algo no cuadra. El add-on no lee los
  movimientos que ya tienes en Wealthfolio.
- **Transferencias internas**: el dinero que mueves entre dos cuentas tuyas sincronizadas se
  registra como transferencia (`TRANSFER_OUT` / `TRANSFER_IN`), no como gasto e ingreso.
- **Comprobación de saldo**: compara el saldo que da el banco con el de Wealthfolio.
- Tus datos solo viajan entre tu equipo y `api.enablebanking.com`.

Requiere **Wealthfolio 3.13.1 o superior** (en Windows, las versiones anteriores admiten unos 1.280 caracteres por
secreto y no pueden guardar la clave privada, que ocupa más).

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
`wealthfolio-enable-banking-sync-addon-1.2.0.zip`. Acepta los permisos:

| Permiso | Para qué |
| --- | --- |
| Cuentas (`getAll`) | Listar tus cuentas de Wealthfolio para asociarlas con las del banco |
| Actividades (`checkImport`, `import`) | Validar e importar los movimientos (no puede leer, editar ni borrar los que ya tienes) |
| Cartera (`getLatestValuations`) | Leer el saldo de cada cuenta en Wealthfolio para compararlo con el del banco |
| Secretos | Guardar cifrada la clave privada y el token temporal de acceso |
| Red (`api.enablebanking.com`) | Hablar con Enable Banking |
| Eventos (`onUpdateComplete`) | Refrescar la comparación de saldos cuando Wealthfolio termina de recalcular |

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
   por cada cuenta del banco. Elige también desde qué fecha importar la primera vez: no hay
   fecha por defecto y, hasta que la elijas, esa cuenta no se sincroniza (ver más abajo).
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
| Cargo en una cuenta y abono del mismo importe en otra tuya, sin IBAN (desactivable) | `TRANSFER_OUT` / `TRANSFER_IN` (internas), ver abajo |
| Movimiento pendiente (`PDNG`) | No se importa hasta que el banco lo contabilice |

El comentario de cada actividad lleva la contraparte y el concepto (`MERCADONA · COMPRA TARJ.
1234`). Los detalles del banco (referencia, fechas de contabilización y valor, código de
operación) se guardan en los metadatos de la actividad.

En cada sincronización se vuelven a leer los 7 días anteriores a la última, para recoger
movimientos que el banco contabiliza tarde. Los ya importados se saltan solos.

Si quedó algún movimiento **pendiente** o **rechazado por Wealthfolio**, la siguiente
sincronización empieza en su fecha, aunque sea más antigua, hasta que entre. Pasados 89 días
se deja de intentar (los bancos no suelen dar más historial) y se avisa en el informe.

### Traspasos sin IBAN

Los pagos de la tarjeta de crédito, las recargas de una tarjeta prepago o los traspasos entre
cuentas no siempre llevan el IBAN de la otra cuenta. Se registran como traspaso interno cuando,
en la misma sincronización, hay un cargo en una cuenta y un abono **del mismo importe y
divisa** en otra cuenta tuya sincronizada, con **3 días como mucho** entre ambos, y además:

- una de las dos cuentas es de tipo *Tarjeta de crédito* en Wealthfolio, o
- el concepto dice «traspaso», «recarga», «liquidación tarjeta», «pago tarjeta»…

Una «transferencia» normal no cuenta, porque igual puede ser un pago a otra persona. Si un
movimiento podría emparejarse con más de uno, no se toca. Wealthfolio enlaza solo las dos
partes cuando tienen la misma fecha; si no, aparecen en el Centro de salud para enlazarlas con
un clic. Se desactiva con la casilla de la tarjeta *Sincronización*.

## Si ya importaste movimientos por CSV

Wealthfolio solo reconoce que un movimiento del banco ya está si coinciden **todos** sus datos,
comentario incluido, y los comentarios de un CSV casi nunca coinciden con los del banco. Por eso,
en la primera sincronización de cada cuenta:

- Mira en Wealthfolio la fecha del último movimiento de esa cuenta y pon como *Importar desde*
  el **día siguiente**. Si la cuenta está vacía, la fecha desde la que quieras historial.
- Mientras no elijas la fecha, esa cuenta no se sincroniza (estado *Revisar fecha*).
- Si te equivocas y se duplica algo, el saldo de Wealthfolio no cuadrará con el del banco y lo
  verás en *Bancos conectados*.

El add-on no consulta tus movimientos para averiguarlo él: así no necesita permiso para leer
el historial de tus cuentas. Esto solo afecta a la primera sincronización (o a cambiar la cuenta
de destino). Después, cada movimiento se reconoce por su identificador (`sourceRecordId`), también
si reinstalas el add-on.

Si sigues importando por CSV alguna cuenta que el banco no comparte (por ejemplo, una tarjeta
prepago), hazlo en una cuenta de Wealthfolio distinta de las que sincroniza el add-on.

## Comprobación de saldo

En cada sincronización se lee el saldo de cada cuenta (como mucho una vez al día, por el
límite de consultas PSD2), prefiriendo el saldo contabilizado. En *Bancos conectados* verás el
saldo del banco junto al de Wealthfolio y si **cuadran**. Un descuadre suele indicar historial
anterior a la fecha de inicio que falta, movimientos pendientes o rechazados, o que Wealthfolio
aún no ha terminado de recalcular. En tarjetas de crédito el banco puede dar la deuda en
positivo; se indica como «cuadra con el signo contrario».

## Limitaciones

- **Consultas al día**: por PSD2, algunos bancos limitan las consultas sin el usuario delante a
  unas 4 al día por cuenta. Si ves un error de límite, espera unas horas.
- **Histórico**: muchos bancos solo dan 90 días de movimientos (algo más justo después de
  autorizar).
- No importa categorías: usa las reglas de categorización de gastos de Wealthfolio.
- El saldo solo se compara, no se importa ni se corrige.
- No todos los bancos dan acceso a las tarjetas (de crédito o prepago) por Open Banking; lo
  sabrás al conectar el banco.
- Es necesario copiar y pegar la URL de vuelta del banco, porque los add-ons se ejecutan en un
  sandbox sin acceso al navegador.

## Desarrollo

Necesitas Node.js 24 y pnpm 10 (`corepack enable`).

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
- `src/lib/sync.ts`: descarga, `checkImport` e `import`, retención de pendientes y rechazados.
- `src/lib/transfers.ts`: emparejado de traspasos sin IBAN.
- `src/lib/balance.ts`: elección y comparación del saldo.
- `scripts/package.mjs`: genera el ZIP sin depender de `zip` (funciona en Windows).
- `src/components`, `src/pages`: interfaz.
