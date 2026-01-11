#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, '..', 'index.ts');

// Resolve tsx loader from package's node_modules
const tsxLoaderPath = join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'loader.mjs');

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
