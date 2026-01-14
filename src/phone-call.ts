import WebSocket, { WebSocketServer } from 'ws'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import type { Server } from 'http'
import {
  loadProviderConfig,
  createProviders,
  createMessagingProvider,
  validateProviderConfig,
} from './providers/index.js';
import { MessagingErrorCode } from './providers/messaging-types.js';
import {
  validateTwilioSignature,
  validateTelnyxSignature,
  generateWebSocketToken,
  validateWebSocketToken,
} from './webhook-security.js';
import { RateLimiter } from './rate-limiter.js';
import { validateWhatsAppMessage, hashForLogging } from './webhook-validation.js';
import { detectCallRequest } from './keyword-detection.js';
import { SessionManager, type CallState, type ServerConfig } from './session-manager.js';
import type { StatusCallbackEvent } from './providers/phone-twilio.js';

// Re-export types for backward compatibility
export type { CallState, ServerConfig } from './session-manager.js';

export function loadServerConfig(publicUrl: string): ServerConfig {
  const providerConfig = loadProviderConfig();
  const errors = validateProviderConfig(providerConfig);

  if (!process.env.CALLME_USER_PHONE_NUMBER) {
    errors.push('Missing CALLME_USER_PHONE_NUMBER (where to call you)');
  }

  if (errors.length > 0) {
    throw new Error(`Missing required configuration:\n  - ${errors.join('\n  - ')}`);
  }

  const providers = createProviders(providerConfig);

  // Create messaging provider if WhatsApp is enabled
  const messagingProvider = createMessagingProvider(providerConfig);

  // Default 3 minutes for transcript timeout
  const transcriptTimeoutMs = parseInt(process.env.CALLME_TRANSCRIPT_TIMEOUT_MS || '180000', 10);

  // Default 7 minutes for inactivity timeout
  const inactivityTimeoutMs = parseInt(process.env.CALLME_INACTIVITY_TIMEOUT_MS || '420000', 10);

  return {
    publicUrl,
    port: parseInt(process.env.CALLME_PORT || '3333', 10),
    phoneNumber: providerConfig.phoneNumber,
    userPhoneNumber: process.env.CALLME_USER_PHONE_NUMBER!,
    providers,
    providerConfig,
    transcriptTimeoutMs,
    inactivityTimeoutMs,
    messagingProvider,
  };
}

export class CallManager {
  private sessionManager: SessionManager;
  private callControlIdToCallId = new Map<string, string>();
  private wsTokenToCallId = new Map<string, string>();  // For WebSocket auth
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private config: ServerConfig;
  private currentCallId = 0;
  private externalServer: boolean = false;
  private rateLimiter: RateLimiter;  // WhatsApp rate limiting

  constructor(config: ServerConfig, existingServer?: ReturnType<typeof createServer>) {
    this.config = config;
    this.sessionManager = new SessionManager(config);
    this.rateLimiter = new RateLimiter();  // Initialize rate limiter with defaults
    if (existingServer) {
      this.httpServer = existingServer;
      this.externalServer = true;
      this.setupWebSocket();
    }
  }

  /**
   * Get activeCalls for backward compatibility
   * @deprecated Use sessionManager directly
   */
  private get activeCalls(): Map<string, CallState> {
    return this.sessionManager.getAllSessions();
  }

  // Public method to handle webhooks from external server
  handleWebhook(req: IncomingMessage, res: ServerResponse): void {
    this.handlePhoneWebhook(req, res);
  }

  private setupWebSocket(): void {
    if (!this.httpServer) return;

    this.wss = new WebSocketServer({ noServer: true });

    this.httpServer.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
      const url = new URL(request.url!, `http://${request.headers.host}`);
      if (url.pathname === '/media-stream') {
        const token = url.searchParams.get('token');

        // If token in URL (e.g., Telnyx), validate immediately
        if (token) {
          const callId = this.wsTokenToCallId.get(token);
          if (!callId) {
            console.error('[Security] Rejecting WebSocket: token not recognized');
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          const state = this.activeCalls.get(callId);
          if (!state || !validateWebSocketToken(state.wsToken, token)) {
            console.error('[Security] Rejecting WebSocket: token validation failed');
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          console.error(`[Security] WebSocket token validated for call ${callId}`);
          this.wss!.handleUpgrade(request, socket, head, (ws) => {
            this.wss!.emit('connection', ws, request, callId);
          });
        } else {
          // No token in URL (Twilio) - accept connection, validate from start message
          // Token will be in customParameters of the "start" message
          console.error('[Security] WebSocket connection accepted, awaiting token in start message');
          this.wss!.handleUpgrade(request, socket, head, (ws) => {
            this.wss!.emit('connection', ws, request, null);  // null callId until validated
          });
        }
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws: WebSocket, _request: IncomingMessage, callId: string | null) => {
      this.handleWebSocketConnection(ws, callId);
    });
  }

  private handleWebSocketConnection(ws: WebSocket, callId: string | null): void {
    console.error(`Media stream WebSocket connected for call ${callId || '(pending validation)'}`);

    // Track the validated callId (may be set later for Twilio)
    let validatedCallId = callId;

    // If callId already known, bind the WebSocket
    if (validatedCallId) {
      const state = this.activeCalls.get(validatedCallId);
      if (state) {
        state.ws = ws;
      }
    }

    ws.on('message', (message: Buffer | string) => {
      const msgBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);

      if (msgBuffer.length > 0 && msgBuffer[0] === 0x7b) {
        try {
          const msg = JSON.parse(msgBuffer.toString());

          // Handle Twilio "start" message - validate token from customParameters
          if (msg.event === 'start') {
            // For Twilio, token is in customParameters
            if (!validatedCallId && msg.start?.customParameters?.token) {
              const token = msg.start.customParameters.token;
              const foundCallId = this.wsTokenToCallId.get(token);

              if (!foundCallId) {
                console.error('[Security] Rejecting WebSocket: token from start message not recognized');
                ws.close(1008, 'Invalid token');
                return;
              }

              const state = this.activeCalls.get(foundCallId);
              if (!state || !validateWebSocketToken(state.wsToken, token)) {
                console.error('[Security] Rejecting WebSocket: token validation failed');
                ws.close(1008, 'Invalid token');
                return;
              }

              console.error(`[Security] WebSocket token validated from start message for call ${foundCallId}`);
              validatedCallId = foundCallId;
              state.ws = ws;
            }

            // Capture streamSid
            if (msg.streamSid && validatedCallId) {
              const msgState = this.activeCalls.get(validatedCallId);
              if (msgState) {
                msgState.streamSid = msg.streamSid;
                console.error(`[${validatedCallId}] Captured streamSid: ${msg.streamSid}`);
                // Cancel any pending disconnect grace timer (connection re-established)
                if (msgState.disconnectGraceTimer) {
                  clearTimeout(msgState.disconnectGraceTimer);
                  msgState.disconnectGraceTimer = undefined;
                  console.error(`[${validatedCallId}] Cancelled disconnect grace timer (stream restarted)`);
                }
              }
            }
          }

          if (msg.event === 'stop' && validatedCallId) {
            const msgState = this.activeCalls.get(validatedCallId);
            if (msgState && !msgState.hungUp) {
              console.error(`[${validatedCallId}] Stream stop received, starting 2s grace period`);
              // Clear any existing grace timer
              if (msgState.disconnectGraceTimer) {
                clearTimeout(msgState.disconnectGraceTimer);
              }
              // Start grace period - only mark as hung up if still disconnected after 2s
              msgState.disconnectGraceTimer = setTimeout(() => {
                if (msgState && !msgState.hungUp) {
                  console.error(`[${validatedCallId}] Stream stopped (confirmed after grace period)`);
                  msgState.hungUp = true;
                }
              }, 2000);
            }
          }
        } catch {
          // Ignore malformed JSON messages from provider
        }
      }

      // Only process audio if we have a validated call
      if (validatedCallId) {
        const audioState = this.activeCalls.get(validatedCallId);
        if (audioState?.sttSession) {
          const audioData = this.extractInboundAudio(msgBuffer);
          if (audioData) {
            audioState.sttSession.sendAudio(audioData);
          }
        }
      }
    });

    ws.on('close', () => {
      console.error('Media stream WebSocket closed');
    });
  }

  startServer(): void {
    if (this.externalServer) {
      console.error(`Using external HTTP server on port ${this.config.port}`);
      return;
    }

    this.httpServer = createServer((req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);

      if (url.pathname === '/twiml') {
        this.handlePhoneWebhook(req, res);
        return;
      }

      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', activeCalls: this.activeCalls.size }));
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    this.wss = new WebSocketServer({ noServer: true });

    this.httpServer.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
      const url = new URL(request.url!, `http://${request.headers.host}`);
      if (url.pathname === '/media-stream') {
        // Try to find the call ID from token
        const token = url.searchParams.get('token');
        let callId = token ? this.wsTokenToCallId.get(token) : null;

        // Reject if no token provided
        if (!token) {
          console.error('[Security] Rejecting WebSocket: missing token');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // Look up call ID from token
        if (!callId) {
          console.error('[Security] Rejecting WebSocket: token not recognized');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // Validate token matches the call state
        const state = this.activeCalls.get(callId);
        if (!state || !validateWebSocketToken(state.wsToken, token)) {
          console.error('[Security] Rejecting WebSocket: token validation failed');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        console.error(`[Security] WebSocket token validated for call ${callId}`);
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request, callId);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws: WebSocket, _request: IncomingMessage, callId: string) => {
      console.error(`Media stream WebSocket connected for call ${callId}`);

      // Associate the WebSocket with the call immediately (token already validated)
      const state = this.activeCalls.get(callId);
      if (state) {
        state.ws = ws;
      }

      ws.on('message', (message: Buffer | string) => {
        const msgBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);

        // Parse JSON messages from Twilio to capture streamSid and handle events
        if (msgBuffer.length > 0 && msgBuffer[0] === 0x7b) {
          try {
            const msg = JSON.parse(msgBuffer.toString());
            const msgState = this.activeCalls.get(callId);

            // Capture streamSid from "start" event (required for sending audio back)
            if (msg.event === 'start' && msg.streamSid && msgState) {
              msgState.streamSid = msg.streamSid;
              console.error(`[${callId}] Captured streamSid: ${msg.streamSid}`);
              // Cancel any pending disconnect grace timer (connection re-established)
              if (msgState.disconnectGraceTimer) {
                clearTimeout(msgState.disconnectGraceTimer);
                msgState.disconnectGraceTimer = undefined;
                console.error(`[${callId}] Cancelled disconnect grace timer (stream restarted)`);
              }
            }

            // Handle "stop" event when call ends
            if (msg.event === 'stop' && msgState && !msgState.hungUp) {
              console.error(`[${callId}] Stream stop received, starting 2s grace period`);
              // Clear any existing grace timer
              if (msgState.disconnectGraceTimer) {
                clearTimeout(msgState.disconnectGraceTimer);
              }
              // Start grace period - only mark as hung up if still disconnected after 2s
              msgState.disconnectGraceTimer = setTimeout(() => {
                if (msgState && !msgState.hungUp) {
                  console.error(`[${callId}] Stream stopped (confirmed after grace period)`);
                  msgState.hungUp = true;
                }
              }, 2000);
            }
          } catch {
            // Ignore malformed JSON messages from provider
          }
        }

        // Forward audio to realtime transcription session
        const audioState = this.activeCalls.get(callId);
        if (audioState?.sttSession) {
          const audioData = this.extractInboundAudio(msgBuffer);
          if (audioData) {
            audioState.sttSession.sendAudio(audioData);
          }
        }
      });

      ws.on('close', () => {
        console.error('Media stream WebSocket closed');
      });
    });

    this.httpServer.listen(this.config.port, () => {
      console.error(`HTTP server listening on port ${this.config.port}`);
    });
  }

  /**
   * Extract INBOUND audio data from WebSocket message (filters out outbound/TTS audio)
   */
  private extractInboundAudio(msgBuffer: Buffer): Buffer | null {
    if (msgBuffer.length === 0) return null;

    // Binary audio (doesn't start with '{') - can't determine track, skip
    if (msgBuffer[0] !== 0x7b) {
      return null;
    }

    // JSON format - only extract inbound track (user's voice)
    try {
      const msg = JSON.parse(msgBuffer.toString());
      if (msg.event === 'media' && msg.media?.payload) {
        const track = msg.media?.track;
        if (track === 'inbound' || track === 'inbound_track') {
          return Buffer.from(msg.media.payload, 'base64');
        }
      }
    } catch {
      // Ignore malformed JSON or non-audio messages
    }

    return null;
  }

  private handlePhoneWebhook(req: IncomingMessage, res: ServerResponse): void {
    const contentType = req.headers['content-type'] || '';
    const MAX_WEBHOOK_BODY_SIZE = 100 * 1024; // 100KB limit for webhook payloads

    // Telnyx sends JSON webhooks
    if (contentType.includes('application/json')) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_WEBHOOK_BODY_SIZE) {
          req.destroy(new Error('Webhook body too large'));
        }
      });
      req.on('end', async () => {
        try {
          // Validate Telnyx signature (required for security)
          const telnyxPublicKey = this.config.providerConfig.telnyxPublicKey;
          if (!telnyxPublicKey) {
            console.error('[Security] Rejecting Telnyx webhook: CALLME_TELNYX_PUBLIC_KEY not configured');
            res.writeHead(500);
            res.end('Server misconfiguration: missing Telnyx public key');
            return;
          }

          const signature = req.headers['telnyx-signature-ed25519'] as string | undefined;
          const timestamp = req.headers['telnyx-timestamp'] as string | undefined;

          if (!validateTelnyxSignature(telnyxPublicKey, signature, timestamp, body)) {
            console.error('[Security] Rejecting Telnyx webhook: invalid signature');
            res.writeHead(401);
            res.end('Invalid signature');
            return;
          }

          const event = JSON.parse(body);
          await this.handleTelnyxWebhook(event, res);
        } catch (error) {
          console.error('Error parsing webhook:', error);
          res.writeHead(400);
          res.end('Invalid JSON');
        }
      });
      return;
    }

    // Twilio sends form-urlencoded webhooks
    if (contentType.includes('application/x-www-form-urlencoded')) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_WEBHOOK_BODY_SIZE) {
          req.destroy(new Error('Webhook body too large'));
        }
      });
      req.on('end', async () => {
        try {
          const params = new URLSearchParams(body);

          // Validate Twilio signature
          const authToken = this.config.providerConfig.phoneAuthToken;
          const signature = req.headers['x-twilio-signature'] as string | undefined;
          // Use the known public URL directly - reconstructing from headers fails with ngrok
          // because ngrok doesn't preserve headers exactly as Twilio sends them
          const webhookUrl = `${this.config.publicUrl}/twiml`;

          if (!validateTwilioSignature(authToken, signature, webhookUrl, params)) {
            console.error('[Security] Rejecting Twilio webhook: invalid signature');
            res.writeHead(401);
            res.end('Invalid signature');
            return;
          }

          await this.handleTwilioWebhook(params, res);
        } catch (error) {
          console.error('Error parsing Twilio webhook:', error);
          res.writeHead(400);
          res.end('Invalid form data');
        }
      });
      return;
    }

    // Fallback: Reject unknown content types
    console.error('[Security] Rejecting webhook with unknown content type:', contentType);
    res.writeHead(400);
    res.end('Invalid content type');
  }

  private async handleTwilioWebhook(params: URLSearchParams, res: ServerResponse): Promise<void> {
    const callSid = params.get('CallSid');
    const callStatus = params.get('CallStatus') as StatusCallbackEvent | null;

    console.error(`Twilio webhook: CallSid=${callSid}, CallStatus=${callStatus}`);

    // Define failure statuses that should trigger WhatsApp fallback
    const failureStatuses: StatusCallbackEvent[] = ['no-answer', 'busy', 'canceled', 'failed'];
    const isFailure = callStatus && failureStatuses.includes(callStatus);

    // Handle call status updates
    if (callStatus === 'completed' || isFailure) {
      // Call ended - find and mark as hung up
      if (callSid) {
        const callId = this.callControlIdToCallId.get(callSid);
        if (callId) {
          this.callControlIdToCallId.delete(callSid);
          const state = this.activeCalls.get(callId);
          if (state) {
            state.hungUp = true;
            state.ws?.close();

            // Trigger WhatsApp fallback if call failed (not if successfully completed)
            if (isFailure && callStatus) {
              // Don't await - let it run in background to avoid blocking webhook response
              this.triggerWhatsAppFallback(callId, callStatus).catch((error) => {
                console.error(`[${callId}] Error in WhatsApp fallback:`, error);
              });
            }
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      return;
    }

    // For 'in-progress' or 'ringing' status, return TwiML to start media stream
    // Include security token in the stream URL
    let streamUrl = `wss://${new URL(this.config.publicUrl).host}/media-stream`;

    // Find the call state to get the WebSocket token
    if (callSid) {
      const callId = this.callControlIdToCallId.get(callSid);
      if (callId) {
        const state = this.activeCalls.get(callId);
        if (state) {
          streamUrl += `?token=${encodeURIComponent(state.wsToken)}`;
        }
      }
    }

    const xml = this.config.providers.phone.getStreamConnectXml(streamUrl);
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end(xml);
  }

  private async handleTelnyxWebhook(event: any, res: ServerResponse): Promise<void> {
    const eventType = event.data?.event_type;
    const callControlId = event.data?.payload?.call_control_id;

    console.error(`Phone webhook: ${eventType}`);

    // Always respond 200 OK immediately
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));

    if (!callControlId) return;

    try {
      switch (eventType) {
        case 'call.initiated':
          break;

        case 'call.answered':
          // Include security token in the stream URL
          let streamUrl = `wss://${new URL(this.config.publicUrl).host}/media-stream`;
          const callId = this.callControlIdToCallId.get(callControlId);
          if (callId) {
            const state = this.activeCalls.get(callId);
            if (state) {
              streamUrl += `?token=${encodeURIComponent(state.wsToken)}`;
            }
          }
          await this.config.providers.phone.startStreaming(callControlId, streamUrl);
          console.error(`Started streaming for call ${callControlId}`);
          break;

        case 'call.hangup':
          const hangupCallId = this.callControlIdToCallId.get(callControlId);
          if (hangupCallId) {
            this.callControlIdToCallId.delete(callControlId);
            const hangupState = this.activeCalls.get(hangupCallId);
            if (hangupState) {
              hangupState.hungUp = true;
              hangupState.ws?.close();
            }
          }
          break;

        case 'call.machine.detection.ended':
          const result = event.data?.payload?.result;
          console.error(`AMD result: ${result}`);
          break;

        case 'streaming.started':
          const streamCallId = this.callControlIdToCallId.get(callControlId);
          if (streamCallId) {
            const streamState = this.activeCalls.get(streamCallId);
            if (streamState) {
              streamState.streamingReady = true;
              console.error(`[${streamCallId}] Streaming ready`);
            }
          }
          break;

        case 'streaming.stopped':
          break;
      }
    } catch (error) {
      console.error(`Error handling webhook ${eventType}:`, error);
    }
  }

  /**
   * Handle WhatsApp webhook from Twilio Conversations
   *
   * SECURITY ARCHITECTURE (Defense in Depth):
   * 1. Signature validation (prevent forged webhooks)
   * 2. Rate limiting (prevent DoS attacks)
   * 3. Input validation (prevent injection attacks)
   * 4. Uniform responses (prevent session enumeration)
   * 5. Constant-time session lookup (prevent timing attacks)
   *
   * @param req HTTP request from Twilio
   * @param res HTTP response to send back
   */
  async handleWhatsAppWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startTime = Date.now();

    // Read request body
    let body = '';
    const MAX_WEBHOOK_BODY_SIZE = 100 * 1024; // 100KB limit
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_WEBHOOK_BODY_SIZE) {
        req.destroy(new Error('Webhook body too large'));
      }
    });

    req.on('end', async () => {
      try {
        // Parse form-urlencoded body
        const params = new URLSearchParams(body);
        const bodyObj: Record<string, string> = {};
        for (const [key, value] of params.entries()) {
          bodyObj[key] = value;
        }

        // Log incoming webhook fields for debugging
        console.error('[WhatsApp Webhook] Received fields:', Object.keys(bodyObj).join(', '));

        // ============================================================
        // NORMALIZE WEBHOOK FORMAT
        // Twilio Sandbox sends Messaging webhooks (From, To, Body, MessageSid)
        // Twilio Conversations sends (ConversationSid, Author, Body)
        // ============================================================

        // Normalize: Map standard Messaging fields to Conversations-style fields
        if (!bodyObj.Author && bodyObj.From) {
          bodyObj.Author = bodyObj.From;
        }
        if (!bodyObj.ConversationSid && bodyObj.MessageSid) {
          // For Messaging webhooks, use a lookup by phone number instead
          // We'll handle this in session lookup
          bodyObj.ConversationSid = bodyObj.MessageSid; // Temporary placeholder
        }

        // ============================================================
        // STEP 1: Signature Validation (CRITICAL - FIRST LINE OF DEFENSE)
        // ============================================================

        const signature = req.headers['x-twilio-signature'] as string | undefined;
        const webhookUrl = `${this.config.publicUrl}/whatsapp`;

        const isValid = validateTwilioSignature(
          this.config.providerConfig.phoneAuthToken,
          signature,
          webhookUrl,
          params
        );

        if (!isValid) {
          console.error('[Security] Invalid WhatsApp webhook signature');
          // Return 401 with empty response (don't leak info)
          res.writeHead(401);
          res.end('');
          return;
        }

        // ============================================================
        // STEP 2: Rate Limiting (CRITICAL - PREVENT DOS)
        // ============================================================

        const conversationSid = bodyObj.ConversationSid || '';
        const author = bodyObj.Author || ''; // Phone number (whatsapp:+1234567890)

        if (this.rateLimiter.isRateLimited(author, conversationSid)) {
          console.error('[Security] Rate limit exceeded', {
            conversationSid,
            authorHash: hashForLogging(author)
          });

          // Return 429 with empty response
          res.writeHead(429);
          res.end('');
          return;
        }

        // ============================================================
        // STEP 3: Input Validation (CRITICAL - PREVENT INJECTION)
        // ============================================================

        const validation = validateWhatsAppMessage(bodyObj);
        if (!validation.valid) {
          console.error('[Security] Invalid WhatsApp message payload', {
            error: validation.error,
            conversationSid
          });

          // Return 200 (don't retry invalid payloads)
          res.writeHead(200);
          res.end('');
          return;
        }

        const messageBody = validation.sanitized!;

        // ============================================================
        // STEP 4: Session Lookup (CONSTANT TIME - PREVENT TIMING ATTACKS)
        // ============================================================

        // Try to find session by conversation SID first
        let session = this.sessionManager.getSessionByConversation(conversationSid);

        // If not found, try to find by phone number (for Messaging API webhooks)
        if (!session && author) {
          // Strip whatsapp: prefix to get raw phone number
          const rawPhone = author.replace('whatsapp:', '');
          const realConversationSid = this.sessionManager.getConversationForPhone(rawPhone);
          if (realConversationSid) {
            session = this.sessionManager.getSessionByConversation(realConversationSid);
            console.error('[WhatsApp] Found session via phone lookup', {
              foundConversationSid: realConversationSid
            });
          }
        }

        // UNIFORM RESPONSE: Same response whether session found or not
        // This prevents session enumeration attacks

        if (!session) {
          // Session not found (expired, invalid, or never existed)
          console.error('[WhatsApp] Message for unknown conversation', {
            conversationSid,
            authorHash: author ? hashForLogging(author) : 'none',
            // DO NOT log phone number
          });

          // Return 200 with empty body (SAME as success case)
          res.writeHead(200);
          res.end('');
          return;
        }

        // ============================================================
        // STEP 5: Process Message
        // ============================================================

        try {
          // Refresh inactivity timeout
          this.sessionManager.refreshInactivityTimeout(session);

          // Check for keyword ("call me")
          if (detectCallRequest(messageBody)) {
            // User wants to switch to voice
            console.error(`[${session.callId}] User requested voice call via WhatsApp`);
            await this.initiateVoiceCallFromWhatsApp(session, messageBody);
          } else {
            // Route message to MCP client (placeholder - to be implemented in Phase 5)
            console.error(`[${session.callId}] Received WhatsApp message: ${messageBody.substring(0, 50)}...`);
            await this.routeMessageToMCP(session, messageBody);
          }

          // Return 200 with empty body (SAME as failure case)
          res.writeHead(200);
          res.end('');

        } catch (error) {
          console.error('[WhatsApp] Error processing message', {
            error,
            sessionId: session.callId,
            conversationSid
          });

          // Still return 200 (don't let Twilio retry errors)
          res.writeHead(200);
          res.end('');
        }

        // Log timing (for monitoring)
        const duration = Date.now() - startTime;
        if (duration > 1000) {
          console.error('[Performance] Slow WhatsApp webhook processing', {
            duration,
            conversationSid
          });
        }
      } catch (error) {
        console.error('[WhatsApp] Fatal webhook error:', error);
        res.writeHead(500);
        res.end('');
      }
    });

    req.on('error', (error) => {
      console.error('[WhatsApp] Request error:', error);
      res.writeHead(400);
      res.end('');
    });
  }

  /**
   * Initiate voice call when user requests it via WhatsApp
   *
   * This happens when user sends "call me" or similar keyword via WhatsApp.
   * We attempt to upgrade the conversation from WhatsApp to voice.
   *
   * @param session Current session state (in WhatsApp mode)
   * @param userMessage The message that triggered the call request
   */
  private async initiateVoiceCallFromWhatsApp(session: CallState, _userMessage: string): Promise<void> {
    console.error(`[${session.callId}] Initiating voice call from WhatsApp (keyword detected)`);

    // Get phone number from secure mapping
    const phoneNumber = this.sessionManager.getPhoneForConversation(session.conversationSid!);
    if (!phoneNumber) {
      console.error(`[${session.callId}] Cannot initiate call: phone number not found`);
      // Send error message to user via WhatsApp
      if (this.config.messagingProvider && session.conversationSid) {
        await this.config.messagingProvider.sendMessage(
          session.conversationSid,
          "Sorry, I couldn't retrieve your phone number to call you. Please try again.",
          false
        );
      }
      return;
    }

    try {
      // Attempt to initiate call
      const callControlId = await this.config.providers.phone.initiateCall(
        phoneNumber,
        this.config.phoneNumber,
        `${this.config.publicUrl}/twiml`
      );

      // Update session state to voice mode
      session.contactMode = 'voice';
      session.callControlId = callControlId;
      this.callControlIdToCallId.set(callControlId, session.callId);

      console.error(`[${session.callId}] Voice call initiated: ${callControlId}`);

      // Send confirmation to user via WhatsApp (they'll get a call shortly)
      if (this.config.messagingProvider && session.conversationSid) {
        await this.config.messagingProvider.sendMessage(
          session.conversationSid,
          "Calling you now...",
          false
        );
      }

    } catch (error) {
      console.error(`[${session.callId}] Failed to initiate voice call:`, error);

      // Send error message to user via WhatsApp
      if (this.config.messagingProvider && session.conversationSid) {
        await this.config.messagingProvider.sendMessage(
          session.conversationSid,
          "Sorry, I couldn't place a call to you right now. Let's continue via WhatsApp.",
          false
        );
      }
    }
  }

  /**
   * Route WhatsApp message to MCP client
   *
   * PLACEHOLDER: This will be fully implemented in Phase 5 (MCP Client Updates)
   *
   * For now, this just logs the message and sends a placeholder response.
   * Phase 5 will add proper message routing to the MCP client.
   *
   * @param session Current session state
   * @param message User's message from WhatsApp
   */
  private async routeMessageToMCP(session: CallState, message: string): Promise<void> {
    // Add to conversation history
    if (session.conversationHistory) {
      session.conversationHistory.push({ speaker: 'user', message });
    }

    console.error(`[${session.callId}] Received WhatsApp message: "${message.substring(0, 100)}..."`);

    // Try to resolve any pending response first (for send_message tool)
    if (session.conversationSid && this.resolveWhatsAppResponse(session.conversationSid, message)) {
      console.error(`[${session.callId}] Resolved pending WhatsApp response`);
      return;
    }

    // No pending response - this is an unsolicited message
    // Send acknowledgment that we received it
    if (this.config.messagingProvider && session.conversationSid) {
      const response = "Got it! I'll process your message.";
      await this.config.messagingProvider.sendMessage(
        session.conversationSid,
        response,
        false
      );

      if (session.conversationHistory) {
        session.conversationHistory.push({ speaker: 'claude', message: response });
      }
    }
  }

  /**
   * Trigger WhatsApp fallback when voice call fails
   * This is called when call times out (no-answer, busy, canceled, failed)
   *
   * SECURITY: Never logs phone numbers, only hashed versions
   */
  private async triggerWhatsAppFallback(callId: string, reason: string): Promise<void> {
    const state = this.activeCalls.get(callId);
    if (!state) {
      console.error(`[${callId}] Cannot trigger WhatsApp fallback: call not found`);
      return;
    }

    // Check if messaging provider is available
    if (!this.config.messagingProvider) {
      console.error(`[${callId}] WhatsApp fallback not available: messaging provider not configured`);
      return;
    }

    console.error(`[${callId}] Triggering WhatsApp fallback (reason: ${reason})`);

    try {
      // Create WhatsApp conversation
      const userPhone = `whatsapp:${this.config.userPhoneNumber}`;
      const conversationSid = await this.config.messagingProvider.createConversation(userPhone);

      // Register phone mapping (secure, never logged)
      this.sessionManager.registerPhoneMapping(callId, this.config.userPhoneNumber, conversationSid);

      // Update session state
      state.contactMode = 'whatsapp';
      state.conversationSid = conversationSid;
      state.whatsappSessionExpiry = Date.now() + (24 * 60 * 60 * 1000); // 24 hours from now

      // Set WhatsApp session timer
      this.sessionManager.setWhatsAppSessionTimer(state);

      // Send template message to user
      const templateMessage = `Hi! I tried calling you but couldn't reach you. Let's continue our conversation here via WhatsApp.`;
      await this.config.messagingProvider.sendMessage(conversationSid, templateMessage, true);

      console.error(`[${callId}] WhatsApp fallback successful, conversation ${conversationSid} created`);
    } catch (error: any) {
      console.error(`[${callId}] WhatsApp fallback failed:`, error);

      // Handle specific errors
      if (error.code === MessagingErrorCode.OPT_IN_REQUIRED) {
        console.error(`[${callId}] User needs to join WhatsApp sandbox: ${error.message}`);
      }

      // Fail gracefully - don't throw, just log
      // WhatsApp fallback is a bonus feature, not critical
    }
  }

  // Map to track pending WhatsApp message responses
  private whatsappResponseResolvers: Map<string, (response: string) => void> = new Map();

  /**
   * Send a WhatsApp message directly and wait for response
   */
  async sendWhatsAppMessage(message: string): Promise<{ messageId: string; response: string }> {
    // Check if messaging provider is available
    if (!this.config.messagingProvider) {
      throw new Error('WhatsApp not configured. Set CALLME_WHATSAPP_ENABLED=true and configure Twilio.');
    }

    const messageId = `msg-${++this.currentCallId}-${Date.now()}`;
    console.error(`[${messageId}] Sending WhatsApp message`);

    try {
      // Create WhatsApp conversation
      const userPhone = `whatsapp:${this.config.userPhoneNumber}`;
      const conversationSid = await this.config.messagingProvider.createConversation(userPhone);

      // Create a minimal call state for session tracking
      const state: CallState = {
        callId: messageId,
        contactMode: 'whatsapp',
        conversationSid,
        whatsappSessionExpiry: Date.now() + (24 * 60 * 60 * 1000),
        pendingResponse: true,
        // Minimal required fields for WhatsApp mode
        callControlId: null,
        ws: null,
        streamSid: null,
        streamingReady: false,
        wsToken: '',
        conversationHistory: [],
        startTime: Date.now(),
        hungUp: false,
        sttSession: null,
        isSpeaking: false,
        interrupted: false,
        lastActivityAt: Date.now(),
      };

      this.activeCalls.set(messageId, state);

      // Register phone mapping for response routing (must be after session is added)
      this.sessionManager.registerPhoneMapping(messageId, this.config.userPhoneNumber, conversationSid);
      this.sessionManager.setWhatsAppSessionTimer(state);

      // Send the message
      await this.config.messagingProvider.sendMessage(conversationSid, message, true);
      console.error(`[${messageId}] WhatsApp message sent, waiting for response...`);

      // Wait for response with timeout (3 minutes)
      const response = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          this.whatsappResponseResolvers.delete(conversationSid);
          reject(new Error('WhatsApp response timeout (3 minutes)'));
        }, 180000);

        this.whatsappResponseResolvers.set(conversationSid, (response: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.whatsappResponseResolvers.delete(conversationSid);
          resolve(response);
        });
      });

      return { messageId, response };
    } catch (error: any) {
      console.error(`[${messageId}] WhatsApp message failed:`, error);

      // Clean up the session on failure
      this.sessionManager.removeSession(messageId);

      if (error.code === MessagingErrorCode.OPT_IN_REQUIRED) {
        throw new Error(`User needs to join WhatsApp sandbox first. Send "join ${this.config.providerConfig.whatsappSandboxCode || 'your-code'}" to the Twilio sandbox number.`);
      }

      throw error;
    }
  }

  /**
   * Called by WhatsApp webhook when a response is received
   */
  resolveWhatsAppResponse(conversationSid: string, response: string): boolean {
    const resolver = this.whatsappResponseResolvers.get(conversationSid);
    if (resolver) {
      resolver(response);
      return true;
    }
    return false;
  }

  async initiateCall(message: string): Promise<{ callId: string; response: string; interrupted: boolean }> {
    const callId = `call-${++this.currentCallId}-${Date.now()}`;

    // Create realtime transcription session via provider
    const sttSession = this.config.providers.stt.createSession();
    await sttSession.connect();
    console.error(`[${callId}] STT session connected`);

    // Generate secure token for WebSocket authentication
    const wsToken = generateWebSocketToken();

    const state: CallState = {
      callId,
      callControlId: null,
      ws: null,
      streamSid: null,
      streamingReady: false,
      wsToken,
      conversationHistory: [],
      startTime: Date.now(),
      hungUp: false,
      sttSession,
      isSpeaking: false,
      interrupted: false,
      // WhatsApp fallback state (initially in voice mode)
      contactMode: 'voice',
      conversationSid: undefined,
      whatsappSessionExpiry: undefined,
      pendingResponse: false,
      // Activity tracking
      lastActivityAt: Date.now(),
      inactivityTimer: undefined,
      whatsappSessionTimer: undefined,
    };

    // Set up barge-in detection: when speech is detected during TTS playback, interrupt
    sttSession.onSpeechStart(() => {
      if (state.isSpeaking && !state.interrupted) {
        console.error(`[${callId}] Barge-in detected! User started speaking during TTS playback`);
        state.interrupted = true;
        this.clearAudioBuffer(state);
      }
    });

    this.sessionManager.addSession(callId, state);

    // Register phone mapping for this call (secure, never logged)
    // Note: conversationSid not set yet, will be set when falling back to WhatsApp
    // For now, just track the phone number for potential fallback

    try {
      const callControlId = await this.config.providers.phone.initiateCall(
        this.config.userPhoneNumber,
        this.config.phoneNumber,
        `${this.config.publicUrl}/twiml`
      );

      state.callControlId = callControlId;
      this.callControlIdToCallId.set(callControlId, callId);
      this.wsTokenToCallId.set(wsToken, callId);

      console.error(`Call initiated: ${callControlId} -> ${this.config.userPhoneNumber}`);

      // Start TTS generation in parallel with waiting for connection
      // This reduces latency by generating audio while Twilio establishes the stream
      const ttsPromise = this.generateTTSAudio(message);

      await this.waitForConnectionWithRetry(callId);

      // Send the pre-generated audio and listen for response
      const audioData = await ttsPromise;
      await this.sendPreGeneratedAudio(state, audioData);
      const wasInterrupted = state.interrupted;
      const response = await this.listen(state);
      state.conversationHistory.push({ speaker: 'claude', message });
      state.conversationHistory.push({ speaker: 'user', message: response });

      return { callId, response, interrupted: wasInterrupted };
    } catch (error) {
      state.sttSession?.close();
      // Clean up session and timers on error
      this.sessionManager.removeSession(callId);
      throw error;
    }
  }

  async continueCall(callId: string, message: string): Promise<{ response: string; interrupted: boolean }> {
    const state = this.activeCalls.get(callId);
    if (!state) throw new Error(`No active call: ${callId}`);

    const { response, interrupted } = await this.speakAndListen(state, message);
    state.conversationHistory.push({ speaker: 'claude', message });
    state.conversationHistory.push({ speaker: 'user', message: response });

    return { response, interrupted };
  }

  async speakOnly(callId: string, message: string): Promise<{ interrupted: boolean }> {
    const state = this.activeCalls.get(callId);
    if (!state) throw new Error(`No active call: ${callId}`);

    await this.speak(state, message);
    state.conversationHistory.push({ speaker: 'claude', message });
    return { interrupted: state.interrupted };
  }

  async endCall(callId: string, message: string): Promise<{ durationSeconds: number }> {
    const state = this.activeCalls.get(callId);
    if (!state) throw new Error(`No active call: ${callId}`);

    await this.speak(state, message);

    // Wait for audio to finish playing before hanging up (prevent cutoff)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Hang up the call via phone provider
    if (state.callControlId) {
      await this.config.providers.phone.hangup(state.callControlId);
    }

    // Close sessions and clean up mappings
    state.sttSession?.close();
    state.ws?.close();
    state.hungUp = true;

    // Clean up security token mapping
    this.wsTokenToCallId.delete(state.wsToken);
    if (state.callControlId) {
      this.callControlIdToCallId.delete(state.callControlId);
    }

    const durationSeconds = Math.round((Date.now() - state.startTime) / 1000);

    // Clean up session and timers via SessionManager
    this.sessionManager.removeSession(callId);

    return { durationSeconds };
  }

  private async waitForConnection(callId: string, timeout: number): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const state = this.activeCalls.get(callId);
      // Wait for WebSocket AND streaming to be ready:
      // - Twilio: streamSid is set from "start" WebSocket event
      // - Telnyx: streamingReady is set from "streaming.started" webhook
      const wsReady = state?.ws && state.ws.readyState === WebSocket.OPEN;
      const streamReady = state?.streamSid || state?.streamingReady;
      if (wsReady && streamReady) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('WebSocket connection timeout');
  }

  private async waitForConnectionWithRetry(callId: string): Promise<void> {
    const maxRetries = 3;
    const baseTimeout = 30000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.waitForConnection(callId, baseTimeout);
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));

        // Verify call is still active before retrying
        const state = this.activeCalls.get(callId);
        if (!state || state.hungUp) {
          throw new Error('Call ended during connection retry');
        }
      }
    }
  }

  /**
   * Pre-generate TTS audio (can run in parallel with connection setup)
   * Returns mu-law encoded audio ready to send to Twilio
   */
  private async generateTTSAudio(text: string): Promise<Buffer> {
    console.error(`[TTS] Generating audio for: ${text.substring(0, 50)}...`);
    const tts = this.config.providers.tts;
    const pcmData = await tts.synthesize(text);
    const resampledPcm = this.resample24kTo8k(pcmData);
    const muLawData = this.pcmToMuLaw(resampledPcm);
    console.error(`[TTS] Audio generated: ${muLawData.length} bytes`);
    return muLawData;
  }

  /**
   * Send a single audio chunk to the phone via WebSocket
   */
  private sendMediaChunk(state: CallState, audioData: Buffer): void {
    if (state.ws?.readyState !== WebSocket.OPEN) return;
    const message: Record<string, unknown> = {
      event: 'media',
      media: { payload: audioData.toString('base64') },
    };
    if (state.streamSid) {
      message.streamSid = state.streamSid;
    }
    state.ws.send(JSON.stringify(message));
  }

  /**
   * Clear the Twilio audio buffer (used for barge-in to stop current playback)
   */
  private clearAudioBuffer(state: CallState): void {
    if (state.ws?.readyState !== WebSocket.OPEN) return;
    const message: Record<string, unknown> = {
      event: 'clear',
    };
    if (state.streamSid) {
      message.streamSid = state.streamSid;
    }
    state.ws.send(JSON.stringify(message));
    console.error(`[${state.callId}] Cleared audio buffer (barge-in)`);
  }

  private async sendPreGeneratedAudio(state: CallState, muLawData: Buffer): Promise<void> {
    console.error(`[${state.callId}] Sending pre-generated audio...`);

    // Set up interruption state for barge-in detection
    state.interrupted = false;
    state.isSpeaking = true;

    try {
      const chunkSize = 160;  // 20ms at 8kHz
      for (let i = 0; i < muLawData.length; i += chunkSize) {
        // Check for barge-in interruption
        if (state.interrupted) {
          console.error(`[${state.callId}] Pre-generated audio interrupted by barge-in`);
          return;
        }
        this.sendMediaChunk(state, muLawData.subarray(i, i + chunkSize));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      // Small delay to ensure audio finishes playing before listening
      if (!state.interrupted) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      console.error(`[${state.callId}] Audio sent${state.interrupted ? ' (interrupted)' : ''}`);
    } finally {
      state.isSpeaking = false;
    }
  }

  private async speakAndListen(state: CallState, text: string): Promise<{ response: string; interrupted: boolean }> {
    await this.speak(state, text);
    const interrupted = state.interrupted;
    const response = await this.listen(state);
    return { response, interrupted };
  }

  private async speak(state: CallState, text: string): Promise<void> {
    console.error(`[${state.callId}] Speaking: ${text.substring(0, 50)}...`);

    // Reset interruption state for barge-in detection
    state.interrupted = false;
    state.isSpeaking = true;

    try {
      const tts = this.config.providers.tts;

      // Use streaming if available for lower latency
      if (tts.synthesizeStream) {
        await this.speakStreaming(state, text, tts.synthesizeStream.bind(tts));
      } else {
        const pcmData = await tts.synthesize(text);
        await this.sendAudio(state, pcmData);
      }

      if (!state.interrupted) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      console.error(`[${state.callId}] Speaking done${state.interrupted ? ' (interrupted)' : ''}`);
    } finally {
      state.isSpeaking = false;
    }
  }

  private async speakStreaming(
    state: CallState,
    text: string,
    synthesizeStream: (text: string) => AsyncGenerator<Buffer>
  ): Promise<void> {
    let pendingPcm = Buffer.alloc(0);
    let pendingMuLaw = Buffer.alloc(0);
    const OUTPUT_CHUNK_SIZE = 160; // 20ms at 8kHz
    const SAMPLES_PER_RESAMPLE = 6; // 6 bytes (3 samples) at 24kHz -> 1 sample at 8kHz

    // Jitter buffer: accumulate audio before starting playback to smooth out
    // timing variations from network latency and burst delivery patterns
    const JITTER_BUFFER_MS = 100; // Buffer 100ms of audio before starting
    // 8000 samples/sec ÷ 1000 ms/sec = 8 samples per ms; mu-law is 1 byte per sample
    const JITTER_BUFFER_SIZE = (8000 / 1000) * JITTER_BUFFER_MS; // 800 bytes at 8kHz mu-law
    let playbackStarted = false;

    // Helper to drain and send buffered mu-law audio in chunks (interruptible)
    const drainBuffer = async () => {
      while (pendingMuLaw.length >= OUTPUT_CHUNK_SIZE) {
        // Check for barge-in interruption
        if (state.interrupted) {
          pendingMuLaw = Buffer.alloc(0);
          return;
        }
        this.sendMediaChunk(state, pendingMuLaw.subarray(0, OUTPUT_CHUNK_SIZE));
        pendingMuLaw = pendingMuLaw.subarray(OUTPUT_CHUNK_SIZE);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };

    const stream = synthesizeStream(text);
    try {
      for await (const chunk of stream) {
        // Check for barge-in interruption
        if (state.interrupted) {
          console.error(`[${state.callId}] TTS stream interrupted by barge-in`);
          break;
        }

        pendingPcm = Buffer.concat([pendingPcm, chunk]);

        const completeUnits = Math.floor(pendingPcm.length / SAMPLES_PER_RESAMPLE);
        if (completeUnits > 0) {
          const bytesToProcess = completeUnits * SAMPLES_PER_RESAMPLE;
          const toProcess = pendingPcm.subarray(0, bytesToProcess);
          pendingPcm = pendingPcm.subarray(bytesToProcess);

          const resampled = this.resample24kTo8k(toProcess);
          const muLaw = this.pcmToMuLaw(resampled);
          pendingMuLaw = Buffer.concat([pendingMuLaw, muLaw]);

          // Wait for jitter buffer to fill before starting playback
          if (!playbackStarted && pendingMuLaw.length < JITTER_BUFFER_SIZE) {
            continue;
          }
          playbackStarted = true;

          await drainBuffer();
        }
      }
    } finally {
      // Try to clean up the stream if it supports return()
      if (!state.interrupted) {
        // Send remaining audio (including any buffered audio for short messages)
        await drainBuffer();

        // Send any final partial chunk
        if (pendingMuLaw.length > 0) {
          this.sendMediaChunk(state, pendingMuLaw);
        }
      }
    }
  }

  private async sendAudio(state: CallState, pcmData: Buffer): Promise<void> {
    const resampledPcm = this.resample24kTo8k(pcmData);
    const muLawData = this.pcmToMuLaw(resampledPcm);

    const chunkSize = 160;
    for (let i = 0; i < muLawData.length; i += chunkSize) {
      // Check for barge-in interruption
      if (state.interrupted) {
        console.error(`[${state.callId}] Audio sending interrupted by barge-in`);
        return;
      }
      this.sendMediaChunk(state, muLawData.subarray(i, i + chunkSize));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  private async listen(state: CallState): Promise<string> {
    console.error(`[${state.callId}] Listening...`);

    if (!state.sttSession) {
      throw new Error('STT session not available');
    }

    // Race between getting a transcript and detecting hangup
    const transcript = await Promise.race([
      state.sttSession.waitForTranscript(this.config.transcriptTimeoutMs),
      this.waitForHangup(state),
    ]);

    if (state.hungUp) {
      throw new Error('Call was hung up by user');
    }

    console.error(`[${state.callId}] User said: ${transcript}`);
    return transcript;
  }

  /**
   * Returns a promise that rejects when the call is hung up.
   * Used to race against transcript waiting.
   *
   * The interval is stored on CallState and cleaned up by removeSession()
   * to prevent memory leaks if the race resolves at an edge case timing.
   */
  private waitForHangup(state: CallState): Promise<never> {
    return new Promise((_, reject) => {
      // Clear any existing interval first (defensive)
      if (state.hangupCheckInterval) {
        clearInterval(state.hangupCheckInterval);
      }

      const checkInterval = setInterval(() => {
        if (state.hungUp) {
          clearInterval(checkInterval);
          state.hangupCheckInterval = undefined;
          reject(new Error('Call was hung up by user'));
        }
      }, 100);  // Check every 100ms

      // Store interval on state so removeSession() can clean it up
      state.hangupCheckInterval = checkInterval;
    });
  }

  private resample24kTo8k(pcmData: Buffer): Buffer {
    const inputSamples = pcmData.length / 2;
    const outputSamples = Math.floor(inputSamples / 3);
    const output = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
      // Use linear interpolation instead of point-sampling to reduce artifacts
      // For each output sample, average the 3 surrounding input samples
      // This acts as a simple anti-aliasing low-pass filter
      const baseIdx = i * 3;
      const s0 = pcmData.readInt16LE(baseIdx * 2);
      const s1 = baseIdx + 1 < inputSamples ? pcmData.readInt16LE((baseIdx + 1) * 2) : s0;
      const s2 = baseIdx + 2 < inputSamples ? pcmData.readInt16LE((baseIdx + 2) * 2) : s1;
      const interpolated = Math.round((s0 + s1 + s2) / 3);
      output.writeInt16LE(interpolated, i * 2);
    }

    return output;
  }

  private pcmToMuLaw(pcmData: Buffer): Buffer {
    const muLawData = Buffer.alloc(Math.floor(pcmData.length / 2));
    for (let i = 0; i < muLawData.length; i++) {
      const pcm = pcmData.readInt16LE(i * 2);
      muLawData[i] = this.pcmToMuLawSample(pcm);
    }
    return muLawData;
  }

  private pcmToMuLawSample(pcm: number): number {
    const BIAS = 0x84;
    const CLIP = 32635;
    let sign = (pcm >> 8) & 0x80;
    if (sign) pcm = -pcm;
    if (pcm > CLIP) pcm = CLIP;
    pcm += BIAS;
    let exponent = 7;
    for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent--) {
      expMask >>= 1;
    }
    const mantissa = (pcm >> (exponent + 3)) & 0x0f;
    return (~(sign | (exponent << 4) | mantissa)) & 0xff;
  }

  getHttpServer(): Server | null {
    return this.httpServer
  }

  shutdown(): void {
    // End all active calls and clean up timers
    for (const callId of this.activeCalls.keys()) {
      this.endCall(callId, 'Goodbye!').catch(console.error);
    }

    // Clean up any remaining sessions (in case endCall failed)
    for (const callId of this.activeCalls.keys()) {
      this.sessionManager.removeSession(callId);
    }

    this.wss?.close();
    this.httpServer?.close();
  }
}
