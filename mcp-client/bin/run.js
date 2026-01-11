#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, '..', 'index.ts');

// Spawn node with tsx loader using --import flag (Node 20.6+/18.19+ compatible)
const child = spawn(
  process.execPath,
  ['--import', 'tsx', indexPath],
  {
    stdio: 'inherit',
    env: process.env,
  }
);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
