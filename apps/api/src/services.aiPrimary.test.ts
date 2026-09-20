import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAiClient } from './services.js';

/** Every provider configured, so ordering is the only thing under test. */
const everything = {
  geminiApiKey: 'g',
  openrouterApiKey: 'o',
  nvidiaApiKey: 'n',
  groqApiKey: 'q',
  awsAccessKeyId: 'a',
  awsSecretAccessKey: 's'
};

test('the default cascade is Gemini, OpenRouter, NVIDIA, Groq, then Bedrock', () => {
  assert.deepEqual(buildAiClient(everything).providerNames, ['gemini', 'openrouter', 'nvidia', 'groq', 'bedrock']);
});

test('AI_PRIMARY=bedrock moves Bedrock first and leaves the rest in order', () => {
  assert.deepEqual(
    buildAiClient({ ...everything, primary: 'bedrock' }).providerNames,
    ['bedrock', 'gemini', 'openrouter', 'nvidia', 'groq']
  );
});

test('a primary naming a provider with no key configured changes nothing', () => {
  // Bedrock has no credentials here, so it is not in the cascade to promote.
  const client = buildAiClient({ geminiApiKey: 'g', groqApiKey: 'q', primary: 'bedrock' });
  assert.deepEqual(client.providerNames, ['gemini', 'groq']);
});

test('a primary is never able to empty the cascade', () => {
  const client = buildAiClient({ ...everything, primary: 'nonsense' });
  assert.equal(client.providerNames.length, 5);
  assert.equal(client.isConfigured, true);
});
