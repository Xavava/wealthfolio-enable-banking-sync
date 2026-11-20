import { createPrivateKey, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEnableBankingJwt, pemToPkcs8Der } from '../src/lib/jwt';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs8Pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pkcs1Pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function decodePart(part: string) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function verifyJwt(token: string) {
  const [header, payload, signature] = token.split('.');
  return verify(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    publicKey,
    Buffer.from(signature, 'base64url'),
  );
}

describe('createEnableBankingJwt', () => {
  it.each([
    ['PKCS#8', pkcs8Pem],
    ['PKCS#1', pkcs1Pem],
  ])('signs a verifiable RS256 token with a %s key', async (_label, pem) => {
    const now = Date.UTC(2026, 10, 20, 10, 0, 0);
    const { token, expiresAt } = await createEnableBankingJwt('app-123', pem, { now });
    const [header, payload] = token.split('.');

    expect(decodePart(header)).toEqual({ typ: 'JWT', alg: 'RS256', kid: 'app-123' });
    expect(decodePart(payload)).toEqual({
      iss: 'enablebanking.com',
      aud: 'api.enablebanking.com',
      iat: now / 1000,
      exp: now / 1000 + 3600,
    });
    expect(expiresAt).toBe(now / 1000 + 3600);
    expect(token).not.toMatch(/[+/=]/);
    expect(verifyJwt(token)).toBe(true);
  });

  it('wraps PKCS#1 keys into PKCS#8 that Node can parse', () => {
    const der = pemToPkcs8Der(pkcs1Pem);
    const reparsed = createPublicKey(createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' }));
    expect(reparsed.export({ format: 'jwk' }).n).toBe(publicKey.export({ format: 'jwk' }).n);
  });

  it('rejects non-PEM and encrypted keys with a clear message', () => {
    expect(() => pemToPkcs8Der('not a key')).toThrow(/PEM/);
    expect(() =>
      pemToPkcs8Der('-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----'),
    ).toThrow(/cifrada/);
  });
});
