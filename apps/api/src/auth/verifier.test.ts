import assert from 'node:assert/strict';
import test from 'node:test';

import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

import { ConvexTokenVerifier, FirstMatchVerifier, GuestTokenVerifier, subjectUserId } from './verifier.js';

const SECRET = 'test-secret-at-least-16-chars';
const SITE = 'https://acme-1.convex.site';

/** A stand-in for Convex's published keys, so the real verification path runs unmocked. */
async function convexKeyPair() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk: JWK = await exportJWK(publicKey);
  const verifier = new ConvexTokenVerifier({ siteUrl: SITE, keys: async () => publicKey });
  return { privateKey, jwk, verifier };
}

async function convexToken(
  privateKey: Parameters<InstanceType<typeof SignJWT>['sign']>[0],
  overrides: { sub?: string; issuer?: string; audience?: string; expired?: boolean } = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(overrides.sub ?? 'user_abc|session_xyz')
    .setIssuer(overrides.issuer ?? SITE)
    .setAudience(overrides.audience ?? 'convex')
    .setIssuedAt(now - 60)
    .setExpirationTime(overrides.expired ? now - 10 : now + 3600)
    .sign(privateKey);
}

test('a guest token identifies the guest that minted it', async () => {
  const guest = new GuestTokenVerifier(SECRET);
  const caller = await guest.verify(guest.sign('guest-1'));
  assert.deepEqual(caller, { userId: 'guest-1', source: 'guest' });
});

test('a guest token signed with another secret is rejected', async () => {
  const caller = await new GuestTokenVerifier(SECRET).verify(new GuestTokenVerifier('a-different-secret-16').sign('guest-1'));
  assert.equal(caller, null);
});

test('a Convex token resolves to the user behind the session', async () => {
  const { privateKey, verifier } = await convexKeyPair();
  const caller = await verifier.verify(await convexToken(privateKey));
  assert.deepEqual(caller, { userId: 'user_abc', source: 'convex' });
});

test('Convex tokens from another deployment, audience or expiry are rejected', async () => {
  const { privateKey, verifier } = await convexKeyPair();
  for (const overrides of [
    { issuer: 'https://someone-else.convex.site' },
    { audience: 'not-convex' },
    { expired: true }
  ]) {
    assert.equal(await verifier.verify(await convexToken(privateKey, overrides)), null, JSON.stringify(overrides));
  }
});

test('a token signed by a different key is rejected even with the right claims', async () => {
  const mine = await convexKeyPair();
  const attacker = await convexKeyPair();
  assert.equal(await mine.verifier.verify(await convexToken(attacker.privateKey)), null);
});

test('the composite accepts either kind and still rejects nonsense', async () => {
  const guest = new GuestTokenVerifier(SECRET);
  const { privateKey, verifier } = await convexKeyPair();
  const composite = new FirstMatchVerifier(guest, verifier);

  assert.equal((await composite.verify(guest.sign('guest-2')))?.source, 'guest');
  assert.equal((await composite.verify(await convexToken(privateKey)))?.source, 'convex');
  assert.equal(await composite.verify('not.a.token'), null);
});

test('a missing Convex verifier leaves guest sessions working', async () => {
  const guest = new GuestTokenVerifier(SECRET);
  const composite = new FirstMatchVerifier(guest, undefined);
  assert.equal((await composite.verify(guest.sign('guest-3')))?.userId, 'guest-3');
});

test('subjects are read back to the user, not the session', () => {
  assert.equal(subjectUserId('user_abc|session_1'), 'user_abc');
  assert.equal(subjectUserId('user_abc'), 'user_abc');
  assert.equal(subjectUserId(undefined), null);
  assert.equal(subjectUserId('|session_1'), null);
});
