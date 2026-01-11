#!/usr/bin/env bun

/**
 * CallMe Cloud Server
 *
 * A cloud-hosted version of call-me that exposes REST API endpoints
 * instead of using MCP stdio. Designed for deployment on Railway/Render/etc.
 *
 * No ngrok needed - the cloud platform provides the public URL.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';

const port = parseInt(process.env.PORT || '3333', 10);
const API_KEY = process.env.CALLME_API_KEY;

// Start HTTP server immediately for health checks
const server = createServer();
let callManager: any = null;
let publicUrl = '';
let configError = '';

// Validate required API key at startup
if (!API_KEY) {
  configError = 'Missing required CALLME_API_KEY environment variable';
  console.error(`FATAL: ${configError}`);
}

function authenticate(req: IncomingMessage): boolean {
  if (!API_KEY) return false;  // Fail closed if API key not configured
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === API_KEY;
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const MAX_BODY_SIZE = 100 * 1024; // 100KB - reasonable limit for JSON API requests

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        req.destroy(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Handle all HTTP requests
server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);

  // Health check - always available
  if (url.pathname === '/health') {
    if (configError) {
      jsonResponse(res, 503, { status: 'error', error: configError });
    } else if (!callManager) {
      jsonResponse(res, 503, { status: 'starting' });
    } else {
      jsonResponse(res, 200, { status: 'ok', publicUrl });
    }
    return;
  }

  // If not configured yet, reject other requests
  if (!callManager) {
    jsonResponse(res, 503, { error: configError || 'Server starting...' });
    return;
  }

  // Twilio webhook (voice calls)
  if (url.pathname === '/twiml') {
    // Forward to call manager's webhook handler
    callManager.handleWebhook(req, res);
    return;
  }

  // WhatsApp webhook (messaging)
  if (url.pathname === '/whatsapp' && req.method === 'POST') {
    // Forward to call manager's WhatsApp webhook handler
    callManager.handleWhatsAppWebhook(req, res);
    return;
  }

  // API endpoints
  if (url.pathname.startsWith('/api/')) {
    // Note: CORS headers removed - MCP client uses server-to-server fetch which doesn't need CORS

    if (!authenticate(req)) {
      jsonResponse(res, 401, { error: 'Unauthorized' });
      return;
    }

    try {
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

      if (url.pathname.match(/^\/api\/call\/[^/]+\/continue$/) && req.method === 'POST') {
        const callId = url.pathname.split('/')[3];
        const body = JSON.parse(await readBody(req));
        const { message } = body;
        if (!message) {
          jsonResponse(res, 400, { error: 'message is required' });
          return;
        }
        const result = await callManager.continueCall(callId, message);
        jsonResponse(res, 200, result);
        return;
      }

      if (url.pathname.match(/^\/api\/call\/[^/]+\/speak$/) && req.method === 'POST') {
        const callId = url.pathname.split('/')[3];
        const body = JSON.parse(await readBody(req));
        const { message } = body;
        if (!message) {
          jsonResponse(res, 400, { error: 'message is required' });
          return;
        }
        const result = await callManager.speakOnly(callId, message);
        jsonResponse(res, 200, result);
        return;
      }

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

  res.writeHead(404);
  res.end('Not Found');
});

// Start server immediately
server.listen(port, () => {
  console.error(`HTTP server listening on port ${port}`);
});

// Initialize call manager async
async function initializeCallManager() {
  const { CallManager, loadServerConfig } = await import('./phone-call.js');

  // Get public URL
  publicUrl = process.env.CALLME_PUBLIC_URL || '';
  if (!publicUrl) {
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    if (railwayDomain) {
      publicUrl = `https://${railwayDomain}`;
    } else if (renderUrl) {
      publicUrl = renderUrl;
    } else {
      publicUrl = `http://localhost:${port}`;
      console.error('Warning: No public URL configured');
    }
  }

  console.error(`Public URL: ${publicUrl}`);

  try {
    const serverConfig = loadServerConfig(publicUrl);
    callManager = new CallManager(serverConfig, server);
    console.error('CallMe Cloud Server ready');
    console.error(`Phone: ${serverConfig.phoneNumber} -> ${serverConfig.userPhoneNumber}`);
  } catch (error) {
    configError = error instanceof Error ? error.message : 'Configuration error';
    console.error('Configuration error:', configError);
  }
}

initializeCallManager();

// Graceful shutdown
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
