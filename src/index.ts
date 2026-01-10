#!/usr/bin/env bun

/**
 * CallMe Cloud Server
 *
 * A cloud-hosted version of call-me that exposes REST API endpoints
 * instead of using MCP stdio. Designed for deployment on Railway/Render/etc.
 *
 * No ngrok needed - the cloud platform provides the public URL.
 */

import { CallManager, loadServerConfig } from './phone-call.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';

// Simple API key auth
const API_KEY = process.env.CALLME_API_KEY || 'change-me-in-production';

function authenticate(req: IncomingMessage): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === API_KEY;
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function main() {
  const port = parseInt(process.env.PORT || '3333', 10);

  // Railway provides the public URL via RAILWAY_PUBLIC_DOMAIN
  // Render provides it via RENDER_EXTERNAL_URL
  // Fall back to manual configuration
  let publicUrl = process.env.CALLME_PUBLIC_URL;
  if (!publicUrl) {
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    if (railwayDomain) {
      publicUrl = `https://${railwayDomain}`;
    } else if (renderUrl) {
      publicUrl = renderUrl;
    } else {
      console.error('Warning: No public URL configured. Set CALLME_PUBLIC_URL, RAILWAY_PUBLIC_DOMAIN, or RENDER_EXTERNAL_URL');
      publicUrl = `http://localhost:${port}`;
    }
  }

  console.error(`Public URL: ${publicUrl}`);

  // Load config and create call manager
  let serverConfig;
  try {
    serverConfig = loadServerConfig(publicUrl);
  } catch (error) {
    console.error('Configuration error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const callManager = new CallManager(serverConfig);

  // Get the internal HTTP server from call manager (handles webhooks)
  callManager.startServer();
  const internalServer = callManager.getHttpServer();

  // Create API server on the same port by wrapping the internal server's handler
  const originalHandler = internalServer?.listeners('request')[0] as any;

  // Remove original handler and add our wrapper
  if (originalHandler) {
    internalServer?.removeListener('request', originalHandler);
  }

  internalServer?.on('request', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    // API endpoints
    if (url.pathname.startsWith('/api/')) {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Auth check for API endpoints
      if (!authenticate(req)) {
        jsonResponse(res, 401, { error: 'Unauthorized' });
        return;
      }

      try {
        // POST /api/call - Initiate a call
        if (url.pathname === '/api/call' && req.method === 'POST') {
          const body = JSON.parse(await readBody(req));
          const { message } = body;

          if (!message) {
            jsonResponse(res, 400, { error: 'message is required' });
            return;
          }

          const result = await callManager.initiateCall(message);
          jsonResponse(res, 200, result);
          return;
        }

        // POST /api/call/:id/continue - Continue a call
        if (url.pathname.match(/^\/api\/call\/[^/]+\/continue$/) && req.method === 'POST') {
          const callId = url.pathname.split('/')[3];
          const body = JSON.parse(await readBody(req));
          const { message } = body;

          if (!message) {
            jsonResponse(res, 400, { error: 'message is required' });
            return;
          }

          const response = await callManager.continueCall(callId, message);
          jsonResponse(res, 200, { response });
          return;
        }

        // POST /api/call/:id/speak - Speak without waiting for response
        if (url.pathname.match(/^\/api\/call\/[^/]+\/speak$/) && req.method === 'POST') {
          const callId = url.pathname.split('/')[3];
          const body = JSON.parse(await readBody(req));
          const { message } = body;

          if (!message) {
            jsonResponse(res, 400, { error: 'message is required' });
            return;
          }

          await callManager.speakOnly(callId, message);
          jsonResponse(res, 200, { success: true });
          return;
        }

        // POST /api/call/:id/end - End a call
        if (url.pathname.match(/^\/api\/call\/[^/]+\/end$/) && req.method === 'POST') {
          const callId = url.pathname.split('/')[3];
          const body = JSON.parse(await readBody(req));
          const { message } = body;

          if (!message) {
            jsonResponse(res, 400, { error: 'message is required' });
            return;
          }

          const result = await callManager.endCall(callId, message);
          jsonResponse(res, 200, result);
          return;
        }

        // GET /api/health - Health check
        if (url.pathname === '/api/health' && req.method === 'GET') {
          jsonResponse(res, 200, { status: 'ok', publicUrl });
          return;
        }

        jsonResponse(res, 404, { error: 'Not found' });
      } catch (error) {
        console.error('API error:', error);
        jsonResponse(res, 500, {
          error: error instanceof Error ? error.message : 'Internal server error'
        });
      }
      return;
    }

    // Pass through to original handler (webhooks, health, websocket)
    if (originalHandler) {
      originalHandler(req, res);
    }
  });

  console.error('');
  console.error('CallMe Cloud Server ready');
  console.error(`Public URL: ${publicUrl}`);
  console.error(`Phone: ${serverConfig.phoneNumber} -> ${serverConfig.userPhoneNumber}`);
  console.error('');
  console.error('API Endpoints:');
  console.error('  POST /api/call          - Initiate a call');
  console.error('  POST /api/call/:id/continue - Continue a call');
  console.error('  POST /api/call/:id/speak    - Speak without response');
  console.error('  POST /api/call/:id/end      - End a call');
  console.error('  GET  /api/health        - Health check');
  console.error('');

  // Graceful shutdown
  const shutdown = async () => {
    console.error('\nShutting down...');
    callManager.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
