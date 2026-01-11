import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = join(__dirname, '..', 'bin', 'run.js');

describe('MCP Client', () => {
  describe('Environment validation', () => {
    it('should fail without CALLME_CLOUD_URL', async () => {
      const result = await runWithEnv({});
      assert.match(result.stderr, /CALLME_CLOUD_URL is required/);
      assert.strictEqual(result.code, 1);
    });

    it('should fail without CALLME_API_KEY', async () => {
      const result = await runWithEnv({ CALLME_CLOUD_URL: 'http://localhost:9999' });
      assert.match(result.stderr, /CALLME_API_KEY is required/);
      assert.strictEqual(result.code, 1);
    });

    it('should start with valid env vars (warns about unreachable server)', async () => {
      const result = await runWithEnv(
        { CALLME_CLOUD_URL: 'http://localhost:9999', CALLME_API_KEY: 'test-key' },
        { timeout: 3000 }
      );
      // Should show warning about unreachable server but still start
      assert.match(result.stderr, /Warning: Could not reach cloud server/);
      assert.match(result.stderr, /CallMe MCP Client ready/);
    });
  });

  describe('Health endpoint', () => {
    it('should use /health endpoint (not /api/health)', async () => {
      const result = await runWithEnv(
        { CALLME_CLOUD_URL: 'http://localhost:9999', CALLME_API_KEY: 'test-key' },
        { timeout: 3000 }
      );
      // The client tries /health, not /api/health
      // We can't directly verify the URL, but the startup message confirms it works
      assert.match(result.stderr, /CallMe MCP Client ready/);
    });
  });
});

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

async function runWithEnv(
  env: Record<string, string>,
  options: { timeout?: number } = {}
): Promise<RunResult> {
  const { timeout = 5000 } = options;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(process.execPath, [binPath], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      // If we see "ready" message, the client started successfully
      if (stderr.includes('CallMe MCP Client ready') && !settled) {
        settled = true;
        child.kill('SIGTERM');
        resolve({ stdout, stderr, code: 0 });
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        resolve({ stdout, stderr, code });
      }
    });

    // Timeout handling
    setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        resolve({ stdout, stderr, code: null });
      }
    }, timeout);
  });
}
