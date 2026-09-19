import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Amplify config builds the web app from the monorepo', async () => {
  const amplify = await text('amplify.yml');
  assert.match(amplify, /appRoot: apps\/web/);
  assert.match(amplify, /npm ci/);
  assert.match(amplify, /baseDirectory: dist/);

  const rewrites = JSON.parse(await text('infra/amplify-rewrites.json'));
  assert.equal(rewrites[0].target, '/index.html');
  assert.equal(rewrites[0].status, '200');
});

test('CI runs the release gates and builds the API image', async () => {
  const ci = await text('.github/workflows/ci.yml');
  assert.match(ci, /npm run typecheck/);
  assert.match(ci, /npm run lint/);
  assert.match(ci, /npm test/);
  assert.match(ci, /docker build/);
});

test('AWS templates keep secrets in SSM and use an App Runner instance role', async () => {
  const core = await text('infra/aws/core.yaml');
  const runner = await text('infra/aws/app-runner.yaml');
  assert.match(core, /AWS::DynamoDB::Table/);
  assert.match(core, /TimeToLiveSpecification/);
  assert.match(core, /AWS::SSM::Parameter/);
  assert.match(core, /AWS::Budgets::Budget/);
  assert.match(runner, /RuntimeEnvironmentSecrets/);
  assert.match(runner, /InstanceRoleArn/);
  assert.match(runner, /HealthCheckConfiguration/);
});
