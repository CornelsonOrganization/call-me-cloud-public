#!/usr/bin/env node

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, '..', 'index.ts');

// Register tsx loader for TypeScript
register('tsx/esm', pathToFileURL('./'));

// Import and run the main module
await import(pathToFileURL(indexPath).href);
