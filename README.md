# Enable Banking Sync for Wealthfolio

**English** · [Español](README.es.md)

A [Wealthfolio](https://wealthfolio.app) add-on that imports the transactions of your bank
accounts **with one click** (Santander, BBVA, CaixaBank, ING, Sabadell, Bankinter, Openbank… and
more than 2,000 European banks) through [Enable Banking](https://enablebanking.com), a regulated
bank aggregator (PSD2).

- **Read-only** access: you authorize access on your bank's website; the add-on never sees your
  bank credentials.
- **No duplicates**: every transaction carries a stable identifier (`sourceRecordId`) and
  Wealthfolio skips the ones already imported. Press the button as often as you like.
- **No lost transactions**: pending transactions and those Wealthfolio rejects are checked again
  on every sync until they get in.
- **No overlap with your CSV imports**: on the first sync of each account you choose the date to
  import from, and the balance check warns you if something does not match. The add-on does not
  read the transactions you already have in Wealthfolio.
- **Internal transfers**: money you move between two of your synced accounts is recorded as a
  transfer (`TRANSFER_OUT` / `TRANSFER_IN`), not as spending and income.
- **Balance check**: compares the balance the bank reports with Wealthfolio's.
- Your data only travels between your computer and `api.enablebanking.com`.

Requires **Wealthfolio 3.13.1 or later** (on Windows, earlier versions allow about 1,280
characters per secret and cannot store the private key, which is longer).

Tested with **BBVA** and **Banco de Sabadell** (Spain).

**Language**: the interface follows Wealthfolio's language. It is available in English and
Spanish; any other language shows English.

## 1. Create your Enable Banking application (once)

Enable Banking is free for personal use with your own accounts ("restricted" mode). Everyone
must create **their own** application: its terms do not allow giving access to others.

1. Create an account at [enablebanking.com](https://enablebanking.com) and open the control
   panel → **Applications** → **Register new application**.
2. Choose the **Production** environment, give it a name and add a **redirect URL**, for example
   `https://localhost/callback`. No server needs to exist there: you will only copy the address
   the bank sends you back to.
3. Generate the key in the browser. A file `xxxxxxxx-xxxx-….pem` is downloaded: the file name is
   the **application ID** and its content is the **private key**. Keep it safe and **never share
   it**.
4. In the new application, press **Link accounts** and authorize, at each bank, **every account**
   you want to sync. The application becomes "Active (restricted)": it can only read the accounts
   you link. If you later add another bank or account, link it here too before connecting it in
   the add-on; otherwise the bank will not share any account.

## 2. Install the add-on

Download `wealthfolio-enable-banking-sync-addon-1.8.1.zip` from the *Releases* page. In
Wealthfolio, go to **Settings → Add-ons**, press **Install from file** and select the zip.

> **Important:** in the permissions dialog, under **Network hosts**, tick
> `api.enablebanking.com` before pressing **Approve & install**. The box comes unticked, also
> when you **update** the add-on, and without it the add-on has no internet access.

The permissions it asks for:

| Permission | What for |
| --- | --- |
| Accounts (`getAll`) | List your Wealthfolio accounts to pair them with the bank's |
| Activities (`checkImport`, `import`, `update`) | Validate and import transactions, and put the shop's, payer's or payee's name in the note of a transaction it imported without it. It cannot read or delete the ones you already have; `update` is only used for that note |
| Portfolio (`getLatestValuations`) | Read each account's balance in Wealthfolio to compare it with the bank's |
| Secrets | Store the private key and the short-lived access token encrypted |
| Network (`api.enablebanking.com`) | Talk to Enable Banking |
| Events (`onUpdateComplete`) | Refresh the balance comparison when Wealthfolio finishes recalculating |

**Bank sync** appears in the sidebar.

If you installed or updated without ticking the box, the add-on says that "Wealthfolio did not
let the request out". To fix it: **Settings → Add-ons**, hover over *Enable Banking Sync for
Wealthfolio*, click the **eye** icon ("View permissions"), tick `api.enablebanking.com` under
**Network hosts** and click **Save**.

## 3. Set up and connect your banks

1. **Enable Banking application**: paste the application ID and load the `.pem`. Press *Save and
   check*. The key is stored in the system's credential store.
2. **Connect a bank**: choose country and bank and press *Generate authorization link*.
   - Copy the link and open it in your browser (add-ons cannot open the browser).
   - Authorize at your bank. It takes you to `https://localhost/callback?…&code=…`, a page that
     does not load. This is normal.
   - Copy that full URL from the address bar, paste it in the add-on and press *Complete
     connection*.
3. **Connected banks**: choose which Wealthfolio account each bank account goes into. Create a
   *Cash* (or *Credit Card*) account in Wealthfolio for each bank account first. Also choose the
   date to import from the first time: there is no default and, until you choose it, that
   account is not synced (see below).
4. Press **Sync now**. The *Sync* card lists every synced account with what happened to it: how
   many transactions were downloaded, how many were new and how many were already there, its
   warnings, the history the bank gave and the balance check. *Connected banks* is only for
   setting things up.

Every card folds from its title to take less room, and the add-on remembers how you left it. A
folded card opens by itself when it needs you (an error, a balance that does not match, a consent
about to expire, a start date to choose), and *Sync* always opens when you sync.

When the consent expires (usually after 90 to 180 days, depending on the bank), press **Renew**
on that bank and authorize again. Account pairings and history are kept.

## How transactions are converted

| Bank transaction | Wealthfolio activity |
| --- | --- |
| Debit (`DBIT`) | `WITHDRAWAL` |
| Credit (`CRDT`) | `DEPOSIT` |
| Credit whose description contains "interest" or "intereses" (optional) | `INTEREST` |
| Debit/credit to another of your synced accounts (same IBAN) | `TRANSFER_OUT` / `TRANSFER_IN` (internal) |
| Debit in one account and a credit of the same amount in another of yours, without IBAN (optional) | `TRANSFER_OUT` / `TRANSFER_IN` (internal), see below |
| Pending transaction (`PDNG`) | Not imported until the bank books it |
| Transaction booked without the shop's, payer's or payee's name ("PAGO CON TARJETA EN …", a payroll read the same day), except transfers between your accounts | Imported at once with the bank's description; if the name arrives within 14 days, it is put in front in the note |

Each activity's comment carries the counterparty and the description (`MERCADONA · COMPRA TARJ.
1234`). The bank's details (reference, booking and value dates, transaction code) are kept in the
activity's metadata.

Each activity carries the booking date and, with banks that put it in the transaction's
reference, the time too. Wealthfolio shows it in your time zone and orders each day's
transactions by it. If that time is on another day (a Saturday purchase booked on Monday), the
transaction comes in without a time, on the booking date. Enable Banking gives no time and no bank
documents it, so it is only read in the formats checked so far:

| Bank | Where the time is | What time it is |
| --- | --- | --- |
| BBVA | Digits 19 to 30 of the reference (`YYMMDDhhmmss`, UTC) | For card payments, when you paid; for receipts and transfers, when the bank processed them |
| Banco de Sabadell | Start of the reference (`YYYYMMDDhhmmss`, Spanish time) | The transaction's: on a transfer from BBVA, the same as at BBVA |

With other banks, or if a bank changes its format, transactions come in without a time.

Every sync reads again the 7 days before the last one, to pick up transactions the bank books
late. Those already imported are skipped automatically.

Some banks book a transaction before they send the other party's name: BBVA first sends "PAGO
CON TARJETA EN SUPERMERCADOS" and adds the shop's name days later (it has taken up to 12), and a
payroll read the same day comes without the payer and with a cut description. Such transactions
are imported at once with the bank's description, so the balance matches the bank's. If a sync in
the next 14 days receives the name, the add-on rewrites the note with what the bank sends then,
like the rest (`MERCADONA · PAGO CON TARJETA EN …`); after that it leaves it as it is and the
report says so. Transfers between your accounts (such as round-ups) never get a name and are not
waited for. The add-on keeps a short list of these transactions for those 14 days and reads their
dates again. It only changes the note of the transactions it imported itself: if
you edit the note of one in those days or change its type, the add-on overwrites them.

If a transaction was left **pending** or **rejected by Wealthfolio**, the next sync starts at its
date, even if older, until it gets in. After 89 days it is no longer retried (banks rarely give
more history) and the report warns about it.

### Transfers without IBAN

Credit card repayments, prepaid card top-ups and transfers between accounts do not always carry
the other account's IBAN. They are recorded as an internal transfer when, in the same sync,
there is a debit in one account and a credit **of the same amount and currency** in another of
your synced accounts, **at most 3 days** apart, and also:

- one of the two accounts is a *Credit Card* account in Wealthfolio, or
- the description says "traspaso", "recarga", "liquidación tarjeta", "pago tarjeta"… (Spanish
  bank wording).

A plain "transfer" does not count, because it may as well be a payment to someone else. If a
transaction could be paired with more than one, it is left alone. Wealthfolio links both sides by
itself when they have the same date; otherwise they show up in the Health Center to be linked
with one click. Turn it off with the checkbox in the *Sync* card.

## If you already imported transactions from a CSV

Wealthfolio only recognizes that a bank transaction is already there if **all** its data match,
comment included, and CSV comments almost never match the bank's. So, on the first sync of each
account:

- Look up in Wealthfolio the date of the last transaction in that account and set *Import from*
  to the **next day**. If the account is empty, the date you want history from.
- Until you choose the date, that account is not synced (status *Check date*).
- If you get it wrong and something is duplicated, the Wealthfolio balance will not match the
  bank's and you will see it in the *Sync* card.
- Conversely, a transaction the bank booked on the last day of the CSV after you downloaded it
  will be in neither: the balance reveals that too.

The add-on does not read your transactions to work this out itself: that way it needs no
permission to read your accounts' history. This only affects the first sync (or changing the
target account). Afterwards, every transaction is recognized by its identifier
(`sourceRecordId`), also if you reinstall the add-on.

If you keep importing from CSV an account the bank does not share (for example, a prepaid card),
do it in a Wealthfolio account other than those the add-on syncs.

## Balance check

The first sync of the day reads each account's balance, after downloading the transactions,
preferring the booked balance. Later syncs do not ask for it again, because of the PSD2 request
limit. The *Sync* card shows the bank's balance next to Wealthfolio's and whether they **match**.
A difference usually means missing history before the start date, pending or rejected
transactions, or that Wealthfolio has not finished recalculating. For credit cards the bank may
report the debt as positive; this shows as "matches (the bank shows it with the opposite sign)".

If a later sync imports transactions into an account, its bank balance no longer includes them.
The difference is still shown, explained as "The bank balance is older than the latest imported
transactions", and **Update balances** appears next to *Sync now*: it reads the balance again for
those accounts only, one request per account. If you do not press it, the balance is read on the
next day's first sync.

The balance compared is the **booked** one, not the *available* balance your bank's app shows:
the difference between them is holds (card payments not settled yet).

## How much history the bank gives

Enable Banking does not publish how much history each bank gives (you can check it in its control
panel, under *Data Insights*). Usually the bank gives long history only for **about an hour after
you authorize** and, afterwards, only the **last 90 days**. For example, BBVA gave almost three
years right after authorizing.

When asked for a range it does not keep, BBVA does not return an error: it returns an **empty**
list. So:

- The first sync of each account, and any sync that starts more than 90 days ago, asks Enable
  Banking for the **longest** history the bank keeps from your start date (`strategy=longest`).
  That way whatever exists gets in, instead of nothing.
- The *Sync* card says, for each account, from which date the bank gave transactions and from when
  you asked.
- If the bank returns no transactions at all, the account is **not** marked as synced (status
  *Check date*): the next sync tries again from the same date.
- To get more than 90 days: connect or renew the bank and sync **right away**.

Later syncs ask for the exact range (the last few days), which does not use extra calls to the
bank.

## Limitations

- **Requests per day**: under PSD2, some banks limit requests made without the user present to
  about 4 a day per account. Under the *Sync* title you can see how many times the add-on has
  read transactions today ("Bank reads today: 3 of 4"), for the account with the most. If you see
  a rate-limit error, wait until midnight (that is how BBVA and Sabadell work). Balance reads are
  not part of that count.
- **History**: many banks only give 90 days of transactions, except right after authorizing (see
  *How much history the bank gives*).
- Categories are not imported: use Wealthfolio's spending categorization rules.
- The balance is only compared, never imported or corrected.
- Not every bank gives access to cards (credit or prepaid) through PSD2; you will find out when
  you connect the bank.
- You have to copy and paste the URL the bank sends you back to, because add-ons run in a sandbox
  without access to the browser.

## Security

- Your private key (`.pem`) and application ID are yours: do not publish them, send them to
  anyone or paste them in issues. Whoever has the key can read the linked accounts while the
  consent lasts.
- If you report a bug, remove IBANs, names and transactions from logs and screenshots.

## Development

You need Node.js 24 and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm test          # unit and end-to-end tests against a simulated API
pnpm type-check
pnpm dev:server    # with Wealthfolio in add-on development mode
pnpm bundle        # builds dist/wealthfolio-enable-banking-sync-addon-<version>.zip
```

Structure:

- `src/lib/jwt.ts`: RS256 signing of the Enable Banking JWT with WebCrypto (PKCS#8 and PKCS#1
  keys).
- `src/lib/enable-banking-client.ts`: API client. Wealthfolio's network broker does not allow the
  `Authorization` header, so the JWT is stored as a secret (`api-jwt`) and sent with
  `auth.secretKey`.
- `src/lib/connect.ts`: bank authorization (`/auth` → `/sessions`) and renewal.
- `src/lib/mapping.ts`: conversion of transactions to `ActivityImport`.
- `src/lib/sync.ts`: download, `checkImport`, `import` and `update` (notes of transactions booked without a name), holding back pending and rejected
  transactions.
- `src/lib/transfers.ts`: pairing of transfers without IBAN.
- `src/lib/balance.ts`: choosing and comparing the balance.
- `src/lib/messages.ts`: translatable messages for code outside React.
- `src/i18n`: interface texts. `es.ts` is the original; `en.ts` must have the same keys
  (checked by `test/i18n.test.ts`).
- `scripts/package.mjs`: builds the ZIP without needing `zip` (works on Windows).
- `src/components`, `src/pages`: interface.

## License and notices

[MIT](LICENSE).

This add-on is independent: it is not made, reviewed or endorsed by Wealthfolio or Enable
Banking. Wealthfolio is a trademark of Teymz Inc. Enable Banking and the bank names belong to
their respective owners.
