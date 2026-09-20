import { createAppFromEnv } from './createAppFromEnv.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);
const app = createAppFromEnv(process.env);

const server = app.listen(config.port, () => {
  if (config.nodeEnv !== 'test') {
    process.stdout.write(`Allegra API listening on port ${config.port}\n`);
  }
});

function shutdown(): void {
  server.close((error) => {
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
