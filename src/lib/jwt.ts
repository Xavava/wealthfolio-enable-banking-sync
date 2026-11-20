import { LocalizedError, msg } from './messages';
// RS256 JWT signing for the Enable Banking API, using WebCrypto.
//
// Enable Banking authenticates every API call with a short-lived JWT signed with
// the private key of your application (the .pem file downloaded when you
// registered it). Header: { typ: "JWT", alg: "RS256", kid: <application id> }.
// Payload: { iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp }.

const textEncoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64Decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(textEncoder.encode(JSON.stringify(value)));
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function concat(...parts: Array<Uint8Array | number[]>): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Wraps a PKCS#1 RSAPrivateKey in a PKCS#8 PrivateKeyInfo so WebCrypto can import it. */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  // AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }
  const algorithm = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ];
  const privateKey = concat([0x04, ...derLength(pkcs1.length)], pkcs1);
  const body = concat(version, algorithm, privateKey);
  return concat([0x30, ...derLength(body.length)], body);
}

/** Parses a PEM private key (PKCS#8 or PKCS#1) into PKCS#8 DER bytes. */
export function pemToPkcs8Der(pem: string): Uint8Array {
  const match = pem.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (!match) {
    throw new LocalizedError(msg('errors.pemFormat'));
  }
  const label = match[1];
  const der = base64Decode(match[2].replace(/[^A-Za-z0-9+/=]/g, ''));
  if (label === 'PRIVATE KEY') return der;
  if (label === 'RSA PRIVATE KEY') return pkcs1ToPkcs8(der);
  if (label === 'ENCRYPTED PRIVATE KEY') {
    throw new LocalizedError(msg('errors.pemEncrypted'));
  }
  throw new LocalizedError(msg('errors.keyType', { label }));
}

export async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) {
    throw new LocalizedError(msg('errors.noWebCrypto'));
  }
  const der = pemToPkcs8Der(pem);
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      new Uint8Array(der),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    throw new LocalizedError(msg('errors.keyUnreadable'));
  }
}

export interface SignedJwt {
  token: string;
  /** Expiry as Unix seconds. */
  expiresAt: number;
}

export async function createEnableBankingJwt(
  applicationId: string,
  privateKeyPem: string,
  options: { lifetimeSeconds?: number; now?: number } = {},
): Promise<SignedJwt> {
  const lifetime = options.lifetimeSeconds ?? 3600;
  const iat = Math.floor((options.now ?? Date.now()) / 1000);
  const exp = iat + lifetime;
  const header = encodeJson({ typ: 'JWT', alg: 'RS256', kid: applicationId });
  const payload = encodeJson({
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat,
    exp,
  });
  const signingInput = `${header}.${payload}`;
  const key = await importRsaPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    textEncoder.encode(signingInput),
  );
  return { token: `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`, expiresAt: exp };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
