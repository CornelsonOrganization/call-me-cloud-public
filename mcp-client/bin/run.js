#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, '..', 'index.ts');

// Use createRequire to properly resolve tsx from wherever npm installed it
const require = createRequire(import.meta.url);
const tsxLoaderPath = require.resolve('tsx/esm');

// Spawn node with tsx loader using --import flag (Node 20.6+/18.19+ compatible)
const child = spawn(
  process.execPath,
  ['--import', tsxLoaderPath, indexPath],
  {
    stdio: 'inherit',
    env: process.env,
  }
);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
