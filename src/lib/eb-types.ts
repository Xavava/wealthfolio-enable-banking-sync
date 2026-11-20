// Subset of the Enable Banking API (https://api.enablebanking.com) used by this add-on.
// Only the fields the add-on reads are typed; everything else is optional.

export interface EbApplication {
  name?: string;
  kid?: string;
  environment?: string;
  redirect_urls?: string[];
  active?: boolean;
  description?: string;
  countries?: string[];
}

export interface EbAspsp {
  name: string;
  country: string;
  logo?: string;
  bic?: string;
  beta?: boolean;
  psu_types?: string[];
  /** Maximum consent validity, in seconds. */
  maximum_consent_validity?: number;
  required_psu_headers?: string[];
}

export interface EbAspspsResponse {
  aspsps: EbAspsp[];
}

export interface EbStartAuthResponse {
  url: string;
  authorization_id?: string;
  psu_id_hash?: string;
}

export interface EbGenericIdentification {
  identification?: string;
  scheme_name?: string;
}

export interface EbAccountIdentification {
  iban?: string;
  other?: EbGenericIdentification | null;
}

export interface EbAccount {
  uid: string;
  identification_hash?: string;
  account_id?: EbAccountIdentification | null;
  all_account_ids?: EbGenericIdentification[] | null;
  name?: string | null;
  details?: string | null;
  product?: string | null;
  currency?: string | null;
  cash_account_type?: string | null;
  usage?: string | null;
}

export interface EbSession {
  session_id: string;
  /** POST /sessions returns account objects; GET /sessions/{id} may return uids. */
  accounts: Array<EbAccount | string>;
  aspsp?: { name: string; country: string };
  psu_type?: string;
  access?: { valid_until?: string };
}

export interface EbAmount {
  amount: string;
  currency: string;
}

export interface EbParty {
  name?: string | null;
}

export interface EbTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  merchant_category_code?: string | null;
  transaction_amount: EbAmount;
  creditor?: EbParty | null;
  creditor_account?: EbAccountIdentification | null;
  debtor?: EbParty | null;
  debtor_account?: EbAccountIdentification | null;
  bank_transaction_code?: { description?: string | null; code?: string | null; sub_code?: string | null } | null;
  /** "CRDT" (money in) or "DBIT" (money out). */
  credit_debit_indicator?: string | null;
  /** "BOOK", "PDNG", "CNCL", "HOLD", "OTHR", "RJCT", "SCHD". */
  status?: string | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  balance_after_transaction?: EbAmount | null;
  reference_number?: string | null;
  remittance_information?: string[] | string | null;
  note?: string | null;
}

export interface EbTransactionsResponse {
  transactions: EbTransaction[];
  continuation_key?: string | null;
}

export interface EbBalance {
  name?: string | null;
  balance_amount: EbAmount;
  /** ISO 20022 balance type: CLBD, ITBD, CLAV, ITAV, XPCD, OPBD… */
  balance_type?: string | null;
  last_change_date_time?: string | null;
  reference_date?: string | null;
  last_committed_transaction?: string | null;
}

export interface EbBalancesResponse {
  balances: EbBalance[];
}

export interface EbErrorBody {
  code?: number;
  message?: string;
  error?: string;
  detail?: unknown;
}
