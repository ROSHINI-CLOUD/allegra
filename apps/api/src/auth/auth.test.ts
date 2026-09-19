import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';

import { AuthService, bearerToken } from './auth.js';
import { MemoryUserStore } from '../user/store.js';

test('anonymous JWT creation, header parsing, and persistence', async () => {
  const auth = new AuthService(new MemoryUserStore(), 'test-secret-value');
  const guest = await auth.createGuest();
  assert.equal(typeof guest.token, 'string');
  assert.equal(typeof guest.userId, 'string');
  assert.equal(auth.verify(guest.token)?.userId, guest.userId);
  assert.equal(bearerToken(`Bearer ${guest.token}`), guest.token);
  assert.equal(bearerToken('Token abc'), null);

  const stored = await auth.getUser(guest.userId);
  assert.ok(stored);
  assert.equal(stored.userId, guest.userId);
  await auth.update({ ...stored, libraries: [{ id: 'lib-1', name: 'Later', isPublic: false, songIds: [], createdAt: new Date().toISOString() }] });
  const again = await auth.getUser(guest.userId);
  assert.equal(again?.libraries[0]?.name, 'Later');
});

test('invalid and expired tokens are rejected', () => {
  const auth = new AuthService(new MemoryUserStore(), 'test-secret-value');
  assert.equal(auth.verify('not-a-jwt'), null);
  const expired = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 10 }, 'test-secret-value', { subject: 'user-1' });
  assert.equal(auth.verify(expired), null);
});
