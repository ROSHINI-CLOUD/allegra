import assert from 'node:assert/strict';
import test from 'node:test';

import { CircuitBreaker } from './circuitBreaker.js';

test('circuit breaker opens after consecutive failures and closes on success', () => {
  const breaker = new CircuitBreaker(3, 60_000);
  breaker.failure();
  breaker.failure();
  assert.equal(breaker.isOpen, false);
  breaker.failure();
  assert.equal(breaker.isOpen, true);
  breaker.success();
  assert.equal(breaker.isOpen, false);
});
