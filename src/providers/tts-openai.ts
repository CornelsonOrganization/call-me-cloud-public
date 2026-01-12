/**
 * OpenAI TTS Provider
 *
 * Cloud-based TTS, no self-hosting required.
 * Supports both tts-1 and gpt-4o-mini-tts models.
 *
 * gpt-4o-mini-tts (default): Steerable voice with instructions support, more voices
 * tts-1: Lower latency, fewer voices, no instructions support
 *
 * Pricing: ~$12/1M tokens (gpt-4o-mini-tts), ~$15/1M chars (tts-1)
 */

import OpenAI from 'openai';
import type { TTSProvider, TTSConfig } from './types.js';

export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai';
  private client: OpenAI | null = null;
  private voice: string = 'coral';
  private model: string = 'gpt-4o-mini-tts';
  private instructions?: string;

  initialize(config: TTSConfig): void {
    if (!config.apiKey) {
      throw new Error('OpenAI API key required for TTS');
    }

    // Support regional endpoints (some API keys are regionally locked to us.api.openai.com)
    // OPENAI_API_BASE_URL sets the regional endpoint for all OpenAI APIs
    // For TTS, we convert wss:// to https:// if needed
    let baseURL: string | undefined;
    const envBaseUrl = process.env.OPENAI_API_BASE_URL;
    if (envBaseUrl) {
      baseURL = envBaseUrl.replace('wss://', 'https://');
      // Ensure it ends with /v1 for the OpenAI SDK
      if (!baseURL.includes('/v1')) {
        baseURL = baseURL.replace(/\/$/, '') + '/v1';
      }
    }

    this.client = new OpenAI({ apiKey: config.apiKey, baseURL });
    this.voice = config.voice || 'coral';
    this.model = config.model || 'gpt-4o-mini-tts';
    this.instructions = config.instructions;

    console.error(`TTS provider: OpenAI (${this.model}, voice: ${this.voice}${this.instructions ? ', with instructions' : ''}${baseURL ? `, endpoint: ${baseURL}` : ''})`);
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!this.client) throw new Error('OpenAI TTS not initialized');

    const response = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable' | 'onyx' | 'nova' | 'sage' | 'shimmer' | 'verse',
      input: text,
      response_format: 'pcm',
      speed: 1.0,
      ...(this.instructions && this.model.includes('gpt-4o') ? { instructions: this.instructions } : {}),
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Stream TTS audio as chunks arrive from OpenAI
   * Yields Buffer chunks of PCM audio data
   */
  async *synthesizeStream(text: string): AsyncGenerator<Buffer> {
    if (!this.client) throw new Error('OpenAI TTS not initialized');

    const response = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable' | 'onyx' | 'nova' | 'sage' | 'shimmer' | 'verse',
      input: text,
      response_format: 'pcm',
      speed: 1.0,
      ...(this.instructions && this.model.includes('gpt-4o') ? { instructions: this.instructions } : {}),
    });

    // Get the response body as a readable stream
    const body = response.body;
    if (!body) {
      throw new Error('No response body from OpenAI TTS');
    }

    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          yield Buffer.from(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
