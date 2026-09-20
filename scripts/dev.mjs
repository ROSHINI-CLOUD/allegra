// Runs the API (:8080) and the web app (:5173) together. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const windows = process.platform === 'win32';
const npm = windows ? 'npm.cmd' : 'npm';
const children = [
  ['api', ['--prefix', 'apps/api', 'run', 'dev']],
  ['web', ['--prefix', 'apps/web', 'run', 'dev']]
].map(([name, args]) => {
  const child = spawn(npm, args, { stdio: 'inherit', shell: windows });
  child.on('exit', (code) => {
    if (code) console.error(`[${name}] exited with ${code}`);
    stop();
  });
  return child;
});

function stop() {
  for (const child of children) child.kill();
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
