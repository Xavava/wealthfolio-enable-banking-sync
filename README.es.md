# Enable Banking Sync for Wealthfolio

[English](README.md) · **Español**

Add-on de [Wealthfolio](https://wealthfolio.app) que importa **con un botón** los movimientos de
tus cuentas bancarias (Santander, BBVA, CaixaBank, ING, Sabadell, Bankinter, Openbank… y más de
2.000 bancos europeos) a través de [Enable Banking](https://enablebanking.com), un agregador
bancario regulado (PSD2).

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

Probado con **BBVA** y **Banco de Sabadell** (España).

**Idioma**: la interfaz sigue el idioma de Wealthfolio. Está en español y en inglés; con
cualquier otro idioma se muestra en inglés. El nombre, la entrada de la barra lateral y la
explicación de los permisos que enseña Wealthfolio al instalar solo pueden tener un idioma y
están en inglés.

## 1. Crea tu aplicación en Enable Banking (una sola vez)

Enable Banking es gratuito para uso personal con tus propias cuentas (modo «restringido»). Cada
persona tiene que crear **su propia** aplicación: sus condiciones no permiten dar acceso a otros.

1. Crea una cuenta en [enablebanking.com](https://enablebanking.com) y entra en el panel de
   control → **Applications** → **Register new application**.
2. Elige el entorno **Production**, ponle un nombre y añade una **URL de redirección**, por
   ejemplo `https://localhost/callback`. No tiene que existir ningún servidor ahí: solo
   copiarás la dirección a la que te devuelve el banco.
3. Genera la clave en el navegador. Se descargará un archivo `xxxxxxxx-xxxx-….pem`: el nombre
   del archivo es el **ID de la aplicación** y su contenido es la **clave privada**. Guárdalo
   bien y **no lo compartas nunca**.
4. En la aplicación recién creada pulsa **Link accounts** y autoriza, en cada banco, **cada
   cuenta** que quieras sincronizar. Así la aplicación pasa a «Active (restricted)»: solo podrá
   leer las cuentas que vincules. Si después añades otro banco u otra cuenta, vincúlala también
   aquí antes de conectarla en el add-on; si no, el banco no compartirá ninguna cuenta.

## 2. Instala el add-on

Descarga `wealthfolio-enable-banking-sync-addon-1.8.1.zip` de la página de versiones
(*Releases*). En Wealthfolio, ve a **Ajustes → Complementos**, pulsa **Instalar desde archivo**
y selecciona el zip.

> **Importante:** en la ventana de permisos, en **Hosts de red**, marca
> `api.enablebanking.com` antes de pulsar **Aprobar e instalar**. La casilla viene
> desmarcada, también al **actualizar** el add-on, y sin ella el add-on no tiene acceso a
> internet.

Los permisos que pide:

| Permiso | Para qué |
| --- | --- |
| Cuentas (`getAll`) | Listar tus cuentas de Wealthfolio para asociarlas con las del banco |
| Actividades (`checkImport`, `import`, `update`) | Validar e importar los movimientos, y poner el nombre del comercio, ordenante o beneficiario en la nota de un movimiento que importó sin él. No puede leer ni borrar los que ya tienes; `update` solo se usa para esa nota |
| Cartera (`getLatestValuations`) | Leer el saldo de cada cuenta en Wealthfolio para compararlo con el del banco |
| Secretos | Guardar cifrada la clave privada y el token temporal de acceso |
| Red (`api.enablebanking.com`) | Hablar con Enable Banking |
| Eventos (`onUpdateComplete`) | Refrescar la comparación de saldos cuando Wealthfolio termina de recalcular |

Aparecerá **Bank sync** en la barra lateral.

Si instalaste o actualizaste sin marcar la casilla, el add-on avisará de que «Wealthfolio no ha
dejado salir la petición». Para arreglarlo: **Ajustes → Complementos**, pasa el ratón por
*Enable Banking Sync for Wealthfolio*, pulsa el icono del **ojo** («Ver permisos»), marca
`api.enablebanking.com` en **Hosts de red** y pulsa **Guardar**.

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
4. Pulsa **Sincronizar ahora**. La tarjeta *Sincronización* muestra cada cuenta sincronizada con
   lo que le pasó: cuántos movimientos se descargaron, cuántos eran nuevos y cuántos ya estaban,
   sus avisos, el historial que dio el banco y la comprobación de saldo. *Bancos conectados*
   queda solo para configurar.

Cada tarjeta se pliega desde su título para ocupar menos, y el add-on recuerda cómo la dejaste.
Una tarjeta plegada se despliega sola cuando necesita tu atención (un error, un saldo que no
cuadra, un consentimiento a punto de caducar, una fecha de inicio por elegir), y *Sincronización*
se despliega siempre al sincronizar.

Cuando caduque el consentimiento (normalmente entre 90 y 180 días, según el banco), pulsa
**Renovar** en ese banco y repite la autorización. Se conservan las asociaciones de cuentas y el
historial.

## Cómo se convierten los movimientos

| Movimiento del banco | Actividad en Wealthfolio |
| --- | --- |
| Cargo (`DBIT`) | `WITHDRAWAL` |
| Abono (`CRDT`) | `DEPOSIT` |
| Abono cuyo concepto contiene «intereses» o «interest» (desactivable) | `INTEREST` |
| Cargo/abono hacia otra cuenta tuya sincronizada (mismo IBAN) | `TRANSFER_OUT` / `TRANSFER_IN` (internas) |
| Cargo en una cuenta y abono del mismo importe en otra tuya, sin IBAN (desactivable) | `TRANSFER_OUT` / `TRANSFER_IN` (internas), ver abajo |
| Movimiento pendiente (`PDNG`) | No se importa hasta que el banco lo contabilice |
| Movimiento contabilizado sin el nombre del comercio, ordenante o beneficiario («PAGO CON TARJETA EN …», una nómina leída el mismo día), salvo traspasos entre tus cuentas | Se importa enseguida con el concepto del banco; si el nombre llega en 14 días, se pone delante en la nota |

El comentario de cada actividad lleva la contraparte y el concepto (`MERCADONA · COMPRA TARJ.
1234`). Los detalles del banco (referencia, fechas de contabilización y valor, código de
operación) se guardan en los metadatos de la actividad.

En cada sincronización se vuelven a leer los 7 días anteriores a la última, para recoger
movimientos que el banco contabiliza tarde. Los ya importados se saltan solos.

Algunos bancos contabilizan un movimiento antes de mandar el nombre de la otra parte: BBVA manda
primero «PAGO CON TARJETA EN SUPERMERCADOS» y añade el nombre del comercio días después (hasta
12, que se haya visto), y una nómina leída el mismo día llega sin el ordenante y con el concepto
cortado. Esos movimientos se importan enseguida con el concepto del banco, para que el saldo
cuadre con el del banco. Si una sincronización de los 14 días siguientes recibe el nombre, el
add-on reescribe la nota con lo que mande entonces el banco, como el resto (`MERCADONA · PAGO CON
TARJETA EN …`); pasado ese plazo la deja como está y el informe lo indica. Los traspasos entre
tus cuentas (como los redondeos) nunca traen nombre y no se esperan. El add-on guarda una lista
corta de esos movimientos durante esos 14 días y vuelve a leer sus fechas. Solo cambia la nota de
los movimientos que importó él: si en esos días editas la nota de uno o le cambias el tipo, el
add-on lo sobrescribe.

Si quedó algún movimiento **pendiente** o **rechazado por Wealthfolio**, la siguiente
sincronización empieza en su fecha, aunque sea más antigua, hasta que entre. Pasados 89 días
se deja de intentar (los bancos no suelen dar más historial) y se avisa en el informe.

### Traspasos sin IBAN

Los pagos de la tarjeta de crédito, las recargas de una tarjeta prepago o los traspasos entre
cuentas no siempre llevan el IBAN de la otra cuenta. Se registran como traspaso interno cuando,
en la misma sincronización, hay un cargo en una cuenta y un abono **del mismo importe y
divisa** en otra cuenta tuya sincronizada, con **3 días como mucho** entre ambos, y además:

- una de las dos cuentas es de tipo *Tarjeta de crédito* en Wealthfolio, o
- el concepto dice «traspaso», «recarga», «liquidación tarjeta», «pago tarjeta»… (palabras de
  los bancos españoles).

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
  verás en la tarjeta *Sincronización*.
- Al revés, un movimiento que el banco contabilizó el último día del CSV después de que lo
  descargaras no estará en ninguno de los dos: también lo delata el saldo.

El add-on no consulta tus movimientos para averiguarlo él: así no necesita permiso para leer
el historial de tus cuentas. Esto solo afecta a la primera sincronización (o a cambiar la cuenta
de destino). Después, cada movimiento se reconoce por su identificador (`sourceRecordId`), también
si reinstalas el add-on.

Si sigues importando por CSV alguna cuenta que el banco no comparte (por ejemplo, una tarjeta
prepago), hazlo en una cuenta de Wealthfolio distinta de las que sincroniza el add-on.

## Comprobación de saldo

La primera sincronización del día lee el saldo de cada cuenta, después de bajar los
movimientos, prefiriendo el saldo contabilizado. Las siguientes no lo vuelven a pedir, por el
límite de consultas PSD2. En *Sincronización* verás el saldo del banco junto al de Wealthfolio
y si **cuadran**. Un descuadre suele indicar historial anterior a la fecha de inicio que falta,
movimientos pendientes o rechazados, o que Wealthfolio aún no ha terminado de recalcular. En
tarjetas de crédito el banco puede dar la deuda en positivo; se indica como «cuadra con el signo
contrario».

Si una sincronización posterior importa movimientos en una cuenta, su saldo del banco ya no los
incluye. El descuadre se sigue mostrando, con la explicación «El saldo del banco es anterior a
los últimos movimientos importados», y junto a *Sincronizar ahora* aparece **Actualizar saldos**:
vuelve a leer el saldo solo de esas cuentas, una consulta por cuenta. Si no lo pulsas, se lee en
la primera sincronización del día siguiente.

El saldo que compara es el **contabilizado**, no el *disponible* que muestra la app del banco:
la diferencia entre los dos son las retenciones (pagos con tarjeta aún sin liquidar).

## Cuánto historial da el banco

Enable Banking no publica cuánto historial da cada banco (se puede consultar en su panel, en
*Data Insights*). Lo habitual es que el banco dé historial largo solo durante **más o menos la
hora siguiente a autorizar** y, después, solo los **últimos 90 días**. Por ejemplo, BBVA dio
casi tres años justo después de autorizar.

Si se le pide un rango que no guarda, BBVA no da error: devuelve una lista **vacía**. Por eso:

- La primera sincronización de cada cuenta, y cualquiera que empiece hace más de 90 días, pide a
  Enable Banking el historial **más largo** que conserve el banco a partir de tu fecha de inicio
  (`strategy=longest`). Así entra lo que haya en lugar de nada.
- La tarjeta *Sincronización* dice, para cada cuenta, desde qué fecha dio movimientos el banco y desde cuándo
  los pediste.
- Si el banco no devuelve ningún movimiento, la cuenta **no** se da por sincronizada (estado
  *Revisar fecha*): la siguiente sincronización vuelve a intentarlo desde la misma fecha.
- Para traer más de 90 días: conecta o renueva el banco y sincroniza **enseguida**.

Las sincronizaciones siguientes piden el rango exacto (los últimos días), que no gasta llamadas
de más al banco.

## Limitaciones

- **Consultas al día**: por PSD2, algunos bancos limitan las consultas sin el usuario delante a
  unas 4 al día por cuenta. Bajo el título de *Sincronización* verás cuántas veces ha leído hoy
  el add-on los movimientos («Consultas de hoy: 3 de 4»), según la cuenta que más lleve. Si ves
  un error de límite, espera a medianoche (así funcionan BBVA y Sabadell). Las lecturas de saldo
  no entran en esa cuenta.
- **Histórico**: muchos bancos solo dan 90 días de movimientos, salvo justo después de
  autorizar (ver *Cuánto historial da el banco*).
- No importa categorías: usa las reglas de categorización de gastos de Wealthfolio.
- El saldo solo se compara, no se importa ni se corrige.
- No todos los bancos dan acceso a las tarjetas (de crédito o prepago) por PSD2; lo sabrás al
  conectar el banco.
- Es necesario copiar y pegar la URL de vuelta del banco, porque los add-ons se ejecutan en un
  sandbox sin acceso al navegador.

## Seguridad

- La clave privada (`.pem`) y el ID de tu aplicación son tuyos: no los publiques, no los envíes a
  nadie y no los pegues en incidencias. Quien tenga la clave puede leer las cuentas vinculadas
  mientras el consentimiento siga vigente.
- Si informas de un error, quita de los registros y capturas IBAN, nombres y movimientos.

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
- `src/lib/sync.ts`: descarga, `checkImport`, `import` y `update` (notas de movimientos sin nombre), retención de pendientes y rechazados.
- `src/lib/transfers.ts`: emparejado de traspasos sin IBAN.
- `src/lib/balance.ts`: elección y comparación del saldo.
- `src/lib/messages.ts`: mensajes traducibles del código que no es de React.
- `src/i18n`: textos de la interfaz. `es.ts` es el original; `en.ts` debe tener las mismas
  claves (lo comprueba `test/i18n.test.ts`).
- `scripts/package.mjs`: genera el ZIP sin depender de `zip` (funciona en Windows).
- `src/components`, `src/pages`: interfaz.

## Licencia y avisos

[MIT](LICENSE).

Este add-on es independiente: no está hecho, revisado ni respaldado por Wealthfolio ni por
Enable Banking. Wealthfolio es una marca de Teymz Inc. Enable Banking y los nombres de los bancos
pertenecen a sus respectivos dueños.
