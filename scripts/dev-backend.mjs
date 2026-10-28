// Runs the Go API for local development with the variables from .env (see README "Setup").
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const envFile = `${root}.env`;
if (!existsSync(envFile)) {
  console.error('Missing .env: copy .env.example to .env and fill in the values.');
  process.exit(1);
}
process.loadEnvFile(envFile);
process.env.ADDR ||= '127.0.0.1:8080';

const child = spawn('go', ['run', '.'], { cwd: `${root}backend`, stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 1));
