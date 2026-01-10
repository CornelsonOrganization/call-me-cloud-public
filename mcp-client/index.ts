#!/usr/bin/env bun

/**
 * CallMe MCP Client
 *
 * A local MCP server that forwards tool calls to the cloud-hosted call-me server.
 * This allows Claude Code to use call-me even when behind a VPN that blocks tunneling.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const CLOUD_URL = process.env.CALLME_CLOUD_URL;
const API_KEY = process.env.CALLME_API_KEY;

if (!CLOUD_URL) {
  console.error('Error: CALLME_CLOUD_URL is required');
  console.error('Set it to your Railway/Render deployment URL');
  process.exit(1);
}

if (!API_KEY) {
  console.error('Error: CALLME_API_KEY is required');
  process.exit(1);
}

async function apiCall(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${CLOUD_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API error: ${response.status}`);
  }

  return response.json();
}

async function main() {
  // Verify cloud server is reachable
  try {
    const healthResponse = await fetch(`${CLOUD_URL}/api/health`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    if (!healthResponse.ok) {
      throw new Error(`Health check failed: ${healthResponse.status}`);
    }
    const health = await healthResponse.json() as { publicUrl: string };
    console.error(`Connected to cloud server: ${health.publicUrl}`);
  } catch (error) {
    console.error('Warning: Could not reach cloud server:', error instanceof Error ? error.message : error);
    console.error('Calls may fail until the server is available.');
  }

  const mcpServer = new Server(
    { name: 'callme-client', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // List available tools (same as original call-me)
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'initiate_call',
          description: 'Start a phone call with the user. Use when you need voice input, want to report completed work, or need real-time discussion.',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'What you want to say to the user. Be natural and conversational.',
              },
            },
            required: ['message'],
          },
        },
        {
          name: 'continue_call',
          description: 'Continue an active call with a follow-up message.',
          inputSchema: {
            type: 'object',
            properties: {
              call_id: { type: 'string', description: 'The call ID from initiate_call' },
              message: { type: 'string', description: 'Your follow-up message' },
            },
            required: ['call_id', 'message'],
          },
        },
        {
          name: 'speak_to_user',
          description: 'Speak a message on an active call without waiting for a response.',
          inputSchema: {
            type: 'object',
            properties: {
              call_id: { type: 'string', description: 'The call ID from initiate_call' },
              message: { type: 'string', description: 'What to say to the user' },
            },
            required: ['call_id', 'message'],
          },
        },
        {
          name: 'end_call',
          description: 'End an active call with a closing message.',
          inputSchema: {
            type: 'object',
            properties: {
              call_id: { type: 'string', description: 'The call ID from initiate_call' },
              message: { type: 'string', description: 'Your closing message (say goodbye!)' },
            },
            required: ['call_id', 'message'],
          },
        },
      ],
    };
  });

  // Handle tool calls by forwarding to cloud server
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (request.params.name === 'initiate_call') {
        const { message } = request.params.arguments as { message: string };
        const result = await apiCall('/api/call', { message }) as { callId: string; response: string };

        return {
          content: [{
            type: 'text',
            text: `Call initiated successfully.\n\nCall ID: ${result.callId}\n\nUser's response:\n${result.response}\n\nUse continue_call to ask follow-ups or end_call to hang up.`,
          }],
        };
      }

      if (request.params.name === 'continue_call') {
        const { call_id, message } = request.params.arguments as { call_id: string; message: string };
        const result = await apiCall(`/api/call/${call_id}/continue`, { message }) as { response: string };

        return {
          content: [{ type: 'text', text: `User's response:\n${result.response}` }],
        };
      }

      if (request.params.name === 'speak_to_user') {
        const { call_id, message } = request.params.arguments as { call_id: string; message: string };
        await apiCall(`/api/call/${call_id}/speak`, { message });

        return {
          content: [{ type: 'text', text: `Message spoken: "${message}"` }],
        };
      }

      if (request.params.name === 'end_call') {
        const { call_id, message } = request.params.arguments as { call_id: string; message: string };
        const result = await apiCall(`/api/call/${call_id}/end`, { message }) as { durationSeconds: number };

        return {
          content: [{ type: 'text', text: `Call ended. Duration: ${result.durationSeconds}s` }],
        };
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error('');
  console.error('CallMe MCP Client ready');
  console.error(`Cloud server: ${CLOUD_URL}`);
  console.error('');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
